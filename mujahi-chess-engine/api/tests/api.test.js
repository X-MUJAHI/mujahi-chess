'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { RequestQueue } = require('../src/queue/request-queue');
const { createApp } = require('../src/app');

function createFakeServerDeps() {
  const base = loadConfig();
  const cfg = {
    ...base,
    corsAllowedOrigins: ['https://mujahi-chess.vercel.app'],
    cache: { ttlMs: 0, maxEntries: 0 },
  };
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
      nnueArchitecture: 'SFNNv16',
      defaultNet: 'nn-1a298aa575a0.nnue',
      restarts: 0,
      supportedOptions: [{ name: 'Threads', type: 'spin', default: 1, min: 1, max: 1024 }],
    }),
    analyze({ requestedDepths, onDepthSnapshot }) {
      const results = [...requestedDepths]
        .sort((a, b) => a - b)
        .map((depth) => {
          const snap = {
            depth,
            bestmove: 'e2e4',
            ponder: 'e7e5',
            evaluation: { type: 'cp', value: 0.32, rawCp: 32, perspective: 'white', bound: 'exact' },
            mate: null,
            bound: 'exact',
            pv: ['e2e4', 'e7e5'],
            nodes: depth * 500,
            nps: 120000,
            time: 12,
            terminal: false,
          };
          onDepthSnapshot?.(snap);
          return snap;
        });
      return Promise.resolve({
        bestmove: 'e2e4',
        ponder: 'e7e5',
        terminal: false,
        results,
      });
    },
  };
  const requestQueue = new RequestQueue(engineManager, cfg);
  const app = createApp({ config: cfg, engineManager, requestQueue });
  return { app };
}

test('HTTP endpoints validate inputs, enforce CORS allowlist, and stream SSE snapshots', async () => {
  const { app } = createFakeServerDeps();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.engine.tag, 'sf_19');

    // 2. /v1/engine
    const engineRes = await fetch(`${baseUrl}/v1/engine`);
    assert.equal(engineRes.status, 200);
    const engineJson = await engineRes.json();
    assert.equal(engineJson.commit, 'edb0d9db6731067ec50ce619ff372b463bc4dd5d');

    // 3. Invalid FEN returns 400
    const badFenRes = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: 'invalid-fen', depth: 10 }),
    });
    assert.equal(badFenRes.status, 400);
    const badFenJson = await badFenRes.json();
    assert.equal(badFenJson.error.code, 'INVALID_FEN');

    // 4. Unsupported parameter (attempting to override threads) returns 400
    const badParamRes = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        threads: 16,
      }),
    });
    assert.equal(badParamRes.status, 400);
    const badParamJson = await badParamRes.json();
    assert.equal(badParamJson.error.code, 'UNSUPPORTED_PARAMETER');

    // 5. Blocked CORS origin (e.g., https://www.chess.com) returns 403
    const corsBlocked = await fetch(`${baseUrl}/v1/engine`, {
      headers: { Origin: 'https://www.chess.com' },
    });
    assert.equal(corsBlocked.status, 403);

    // 6. Allowed Vercel origin succeeds
    const corsAllowed = await fetch(`${baseUrl}/v1/engine`, {
      headers: { Origin: 'https://mujahi-chess.vercel.app' },
    });
    assert.equal(corsAllowed.status, 200);
    assert.equal(
      corsAllowed.headers.get('access-control-allow-origin'),
      'https://mujahi-chess.vercel.app'
    );

    // 6b. Chrome extension MV3 service worker origin succeeds when corsAllowExtensions=true
    const extCorsAllowed = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'chrome-extension://klhidcpkkhfcpmjhhikchaikmbefiajf',
      },
      body: JSON.stringify({
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        depths: [5],
      }),
    });
    assert.equal(extCorsAllowed.status, 200);
    assert.equal(
      extCorsAllowed.headers.get('access-control-allow-origin'),
      'chrome-extension://klhidcpkkhfcpmjhhikchaikmbefiajf'
    );

    // 7. SSE streaming endpoint emits started, snapshots, and complete
    const sseRes = await fetch(`${baseUrl}/v1/analyze/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        depths: [5, 10, 15],
        clientSessionId: 'test-session-1',
      }),
    });
    assert.equal(sseRes.status, 200);
    assert.match(sseRes.headers.get('content-type') || '', /text\/event-stream/);
    const sseText = await sseRes.text();
    assert.match(sseText, /event: started/);
    assert.match(sseText, /event: snapshot/);
    assert.match(sseText, /event: complete/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
