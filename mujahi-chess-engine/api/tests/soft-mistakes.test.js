'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { RequestQueue } = require('../src/queue/request-queue');
const { createApp } = require('../src/app');
const { parseUciInfoLine } = require('../src/engine/parser');
const {
  selectStage1Shortlist,
  evaluateSoftMistakeCandidates,
  runSoftMistakeScan,
} = require('../src/utils/soft-mistakes');

test('parseUciInfoLine preserves MultiPV lines when allowMultiPv=true', () => {
  const line2 =
    'info depth 7 seldepth 11 multipv 2 score cp 12 nodes 2400 nps 60000 time 40 pv d2d4 d7d5';
  assert.equal(parseUciInfoLine(line2, 'white'), null);
  const parsed = parseUciInfoLine(line2, 'white', { allowMultiPv: true });
  assert.equal(parsed.multipv, 2);
  assert.equal(parsed.bestmove, 'd2d4');
  assert.equal(parsed.evaluation.rawCp, 12);
});

test('selectStage1Shortlist picks slight drops and rejects forced huge losses', () => {
  const whiteLines = [
    { multipv: 1, bestmove: 'e2e4', evaluation: { type: 'cp', value: 0.4, rawCp: 40 } },
    { multipv: 2, bestmove: 'd2d4', evaluation: { type: 'cp', value: 0.3, rawCp: 30 } }, // drop 10 (<25)
    { multipv: 3, bestmove: 'a2a3', evaluation: { type: 'cp', value: 0.05, rawCp: 5 } }, // drop 35 (good!)
    { multipv: 4, bestmove: 'h2h4', evaluation: { type: 'cp', value: -0.2, rawCp: -20 } }, // drop 60 (good!)
    { multipv: 5, bestmove: 'g2g4', evaluation: { type: 'cp', value: -1.8, rawCp: -180 } }, // drop 220 (too bad)
    { multipv: 6, bestmove: 'f2f3', evaluation: { type: 'mate', value: -3 } }, // mate against white
  ];

  const out = selectStage1Shortlist({
    stage1Lines: whiteLines,
    sideToMove: 'white',
    minDropCp: 25,
    maxDropCp: 85,
    shortlistLimit: 4,
  });
  assert.equal(out.bestLine.bestmove, 'e2e4');
  assert.deepEqual(out.shortlist, ['a2a3', 'h2h4']);

  // Forced best move case: #2 already loses > maxDropCp
  const forcedOut = selectStage1Shortlist({
    stage1Lines: [
      { multipv: 1, bestmove: 'e1d2', evaluation: { type: 'cp', value: 0.1, rawCp: 10 } },
      { multipv: 2, bestmove: 'e1f2', evaluation: { type: 'cp', value: -4.2, rawCp: -420 } },
    ],
    sideToMove: 'white',
    minDropCp: 25,
    maxDropCp: 85,
  });
  assert.deepEqual(forcedOut.shortlist, []);
  assert.equal(forcedOut.reason, 'forced_best_move');
});

test('evaluateSoftMistakeCandidates handles Black POV accurately and filters Stage-2 blunders', () => {
  // Black to move: best is -0.80 whiteCp (good for Black by +80).
  // a7a6 gives -0.35 whiteCp -> Black loses 45 cp (good soft mistake!)
  // h7h5 gives +1.50 whiteCp -> Black loses 230 cp (Stage-2 tactic uncovered -> rejected!)
  const stage2Lines = [
    { multipv: 1, depth: 10, bestmove: 'c7c5', evaluation: { type: 'cp', value: -0.8, rawCp: -80 }, pv: ['c7c5', 'g1f3'] },
    { multipv: 2, depth: 10, bestmove: 'a7a6', evaluation: { type: 'cp', value: -0.35, rawCp: -35 }, pv: ['a7a6', 'f1e2'] },
    { multipv: 3, depth: 10, bestmove: 'h7h5', evaluation: { type: 'cp', value: 1.5, rawCp: 150 }, pv: ['h7h5', 'd1h5'] },
  ];

  const res = evaluateSoftMistakeCandidates({
    lines: stage2Lines,
    bestMoveHint: 'c7c5',
    sideToMove: 'black',
    minDropCp: 25,
    maxDropCp: 85,
    maxResults: 3,
  });

  assert.equal(res.bestMove, 'c7c5');
  assert.equal(res.bestEvalCp, -80);
  assert.equal(res.candidates.length, 1);
  assert.equal(res.candidates[0].move, 'a7a6');
  assert.equal(res.candidates[0].dropCp, 45);
  assert.equal(res.candidates[0].evalCp, -35);
});

test('POST /v1/analyze/soft-mistakes runs 2-stage scan and validates range', async () => {
  const base = loadConfig();
  const cfg = { ...base, cache: { ttlMs: 0, maxEntries: 0 } };
  const calls = [];

  const engineManager = {
    state: 'ready',
    isReady: () => true,
    getStatus: () => ({
      state: 'ready',
      ready: true,
      busy: false,
      version: 'Stockfish 19',
      pinnedTag: 'sf_19',
      pinnedCommit: 'edb0d9db6731067ec50ce619ff372b463bc4dd5d',
      supportedOptions: [],
    }),
    analyzeMultiPv({ targetDepth, multiPv, searchMoves }) {
      calls.push({ targetDepth, multiPv, searchMoves });
      if (!searchMoves) {
        return Promise.resolve({
          bestmove: 'e2e4',
          terminal: false,
          lines: [
            { multipv: 1, depth: 7, bestmove: 'e2e4', evaluation: { type: 'cp', value: 0.32, rawCp: 32 }, pv: ['e2e4'] },
            { multipv: 2, depth: 7, bestmove: 'c2c3', evaluation: { type: 'cp', value: -0.05, rawCp: -5 }, pv: ['c2c3'] },
            { multipv: 3, depth: 7, bestmove: 'b2b3', evaluation: { type: 'cp', value: -0.3, rawCp: -30 }, pv: ['b2b3'] },
          ],
        });
      }
      return Promise.resolve({
        bestmove: 'e2e4',
        terminal: false,
        lines: [
          { multipv: 1, depth: 10, bestmove: 'e2e4', evaluation: { type: 'cp', value: 0.32, rawCp: 32 }, pv: ['e2e4', 'c7c5'] },
          { multipv: 2, depth: 10, bestmove: 'c2c3', evaluation: { type: 'cp', value: -0.08, rawCp: -8 }, pv: ['c2c3', 'd7d5'] },
          { multipv: 3, depth: 10, bestmove: 'b2b3', evaluation: { type: 'cp', value: -0.35, rawCp: -35 }, pv: ['b2b3', 'e7e5'] },
        ],
      });
    },
  };

  const requestQueue = new RequestQueue(engineManager, cfg);
  const app = createApp({ config: cfg, engineManager, requestQueue });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/v1/analyze/soft-mistakes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        minDropCp: 25,
        maxDropCp: 85,
        maxResults: 3,
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.stage2Verified, true);
    assert.equal(json.candidates.length, 2);
    assert.equal(json.candidates[0].move, 'c2c3');
    assert.equal(json.candidates[0].dropCp, 40);
    assert.equal(json.candidates[1].move, 'b2b3');
    assert.equal(json.candidates[1].dropCp, 67);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].searchMoves, ['e2e4', 'c2c3', 'b2b3']);

    // Invalid range (maxDropCp < minDropCp)
    const badRes = await fetch(`${baseUrl}/v1/analyze/soft-mistakes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        minDropCp: 90,
        maxDropCp: 40,
      }),
    });
    assert.equal(badRes.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('runSoftMistakeScan skips Stage 2 cleanly when terminal', async () => {
  let stage2Called = false;
  const out = await runSoftMistakeScan({
    fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1',
    sideToMove: 'black',
    runMultiPv: async ({ searchMoves }) => {
      if (searchMoves) stage2Called = true;
      return { bestmove: null, terminal: true, lines: [] };
    },
  });
  assert.equal(out.reason, 'terminal');
  assert.equal(out.stage2Verified, false);
  assert.equal(stage2Called, false);
});
