'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { RequestQueue } = require('../src/queue/request-queue');
const { createApp } = require('../src/app');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function createLicensedTestApp(state) {
  const base = loadConfig();
  const observedStage2Depths = [];

  const cfg = {
    ...base,
    cache: { ttlMs: 0, maxEntries: 0 },
    auth: {
      requireLicenseKey: true,
      keyServerUrl: '',
      engineAuthSecret: '',
      keyVerifyTimeoutMs: 2000,
      customAuthorizer: async ({ key, fen, requestedMaxDepth, feature }) => {
        const record = state.keys.get(key);
        if (!record || record.revoked) {
          return {
            authorized: false,
            status: 403,
            code: 'INVALID_KEY',
            error: 'License key is invalid or revoked.',
          };
        }

        const maxAllowedDepth = record.tier === 'premium' ? 24 : 7;
        if (feature === 'analyze' && requestedMaxDepth > maxAllowedDepth) {
          return {
            authorized: false,
            status: 403,
            code: 'DEPTH_LOCKED',
            error: `Temporary keys are capped at depth ${maxAllowedDepth}.`,
            tier: record.tier,
            isPremium: false,
            moves_remain: record.movesRemain,
            maxAllowedDepth,
          };
        }

        if (record.tier === 'temporary' && record.movesRemain <= 0) {
          return {
            authorized: false,
            status: 403,
            code: 'MOVES_EXHAUSTED',
            error: 'Temporary key has 0 moves remaining.',
            tier: 'temporary',
            isPremium: false,
            moves_remain: 0,
            maxAllowedDepth,
          };
        }

        const dedupKey = `${key}|${fen}|${feature}`;
        if (!state.seenFens.has(dedupKey)) {
          state.seenFens.add(dedupKey);
          if (record.tier === 'temporary') {
            record.movesRemain -= 1;
          }
        }

        return {
          authorized: true,
          status: 200,
          tier: record.tier,
          isPremium: record.tier === 'premium',
          moves_remain: record.tier === 'premium' ? null : record.movesRemain,
          maxAllowedDepth,
        };
      },
    },
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
      supportedOptions: [],
    }),
    analyze({ requestedDepths, onDepthSnapshot }) {
      const results = [...requestedDepths]
        .sort((a, b) => a - b)
        .map((depth) => {
          const snap = {
            depth,
            bestmove: 'e2e4',
            ponder: 'e7e5',
            evaluation: { type: 'cp', value: 0.3, rawCp: 30, perspective: 'white', bound: 'exact' },
            mate: null,
            bound: 'exact',
            pv: ['e2e4', 'e7e5'],
            nodes: depth * 200,
            nps: 100000,
            time: 10,
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
    analyzeMultiPv({ targetDepth, searchMoves }) {
      observedStage2Depths.push({ targetDepth, isStage2: Array.isArray(searchMoves) });
      return Promise.resolve({
        terminal: false,
        lines: [
          {
            multipv: 1,
            bestmove: 'e2e4',
            depth: targetDepth,
            evaluation: { type: 'cp', value: 0.35, rawCp: 35 },
            mate: null,
            pv: ['e2e4', 'e7e5'],
          },
          {
            multipv: 2,
            bestmove: 'a2a3',
            depth: targetDepth,
            evaluation: { type: 'cp', value: -0.25, rawCp: -25 },
            mate: null,
            pv: ['a2a3', 'e7e5'],
          },
        ],
      });
    },
  };

  const requestQueue = new RequestQueue(engineManager, cfg);
  const app = createApp({ config: cfg, engineManager, requestQueue });
  return { app, observedStage2Depths };
}

test('Server enforces license keys, temporary depth cap, move quota deduction, and fail-closed checks', async () => {
  const state = {
    keys: new Map([
      ['MTEMP123', { tier: 'temporary', movesRemain: 2, revoked: false }],
      ['MPREM999', { tier: 'premium', movesRemain: null, revoked: false }],
    ]),
    seenFens: new Set(),
  };

  const { app, observedStage2Depths } = createLicensedTestApp(state);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. /health stays open without license key
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);

    // 2. Missing key -> 401 LICENSE_KEY_REQUIRED
    const noKeyRes = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: START_FEN, depth: 5 }),
    });
    assert.equal(noKeyRes.status, 401);
    const noKeyJson = await noKeyRes.json();
    assert.equal(noKeyJson.error.code, 'LICENSE_KEY_REQUIRED');

    // 3. Invalid key format -> 403 INVALID_KEY
    const badFormatRes = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'NOT_VALID' },
      body: JSON.stringify({ fen: START_FEN, depth: 5 }),
    });
    assert.equal(badFormatRes.status, 403);
    const badFormatJson = await badFormatRes.json();
    assert.equal(badFormatJson.error.code, 'INVALID_KEY');

    // 4. Temporary key requesting depth > 7 -> 403 DEPTH_LOCKED (and does NOT charge a move)
    const depthLockedRes = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'MTEMP123' },
      body: JSON.stringify({ fen: START_FEN, depths: [5, 10, 15] }),
    });
    assert.equal(depthLockedRes.status, 403);
    const depthLockedJson = await depthLockedRes.json();
    assert.equal(depthLockedJson.error.code, 'DEPTH_LOCKED');
    assert.equal(state.keys.get('MTEMP123').movesRemain, 2);

    // 5. Temporary key requesting depth <= 7 succeeds and charges 1 move
    const tempOkRes = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'MTEMP123' },
      body: JSON.stringify({ fen: START_FEN, depths: [5, 7] }),
    });
    assert.equal(tempOkRes.status, 200);
    assert.equal(tempOkRes.headers.get('x-moves-remaining'), '1');
    const tempOkJson = await tempOkRes.json();
    assert.equal(tempOkJson.quota.tier, 'temporary');
    assert.equal(tempOkJson.quota.movesRemain, 1);
    assert.equal(tempOkJson.quota.maxAllowedDepth, 7);

    // 6. Temporary key soft-mistakes clamps stage 2 depth to <= 7 instead of depth 10
    const softRes = await fetch(`${baseUrl}/v1/analyze/soft-mistakes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'MTEMP123' },
      body: JSON.stringify({ fen: START_FEN, minDropCp: 25, maxDropCp: 85, maxResults: 3 }),
    });
    assert.equal(softRes.status, 200);
    const softJson = await softRes.json();
    assert.equal(softJson.quota.movesRemain, 0);
    const stage2Call = observedStage2Depths.find((x) => x.isStage2);
    assert.ok(stage2Call);
    assert.equal(stage2Call.targetDepth, 7);

    // 7. Next new FEN with 0 remaining moves -> 403 MOVES_EXHAUSTED
    const exhaustedRes = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'MTEMP123' },
      body: JSON.stringify({
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        depth: 5,
      }),
    });
    assert.equal(exhaustedRes.status, 403);
    const exhaustedJson = await exhaustedRes.json();
    assert.equal(exhaustedJson.error.code, 'MOVES_EXHAUSTED');

    // 8. Premium key unlocks depth 15 and returns unlimited quota on SSE stream
    const premStreamRes = await fetch(`${baseUrl}/v1/analyze/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer MPREM999' },
      body: JSON.stringify({ fen: START_FEN, depths: [5, 10, 15] }),
    });
    assert.equal(premStreamRes.status, 200);
    const sseBody = await premStreamRes.text();
    assert.match(sseBody, /"quota":\{"tier":"premium","isPremium":true,"movesRemain":null,"maxAllowedDepth":24\}/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Fail-closed: unconfigured keyServerUrl returns 503 AUTH_UNAVAILABLE when requireLicenseKey=true', async () => {
  const base = loadConfig();
  const cfg = {
    ...base,
    auth: {
      requireLicenseKey: true,
      keyServerUrl: '',
      engineAuthSecret: '',
      keyVerifyTimeoutMs: 1000,
    },
  };
  const engineManager = {
    isReady: () => true,
    getStatus: () => ({ state: 'ready', ready: true, version: 'Stockfish 19' }),
  };
  const requestQueue = new RequestQueue(engineManager, cfg);
  const app = createApp({ config: cfg, engineManager, requestQueue });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'MPREM999' },
      body: JSON.stringify({ fen: START_FEN, depth: 5 }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'AUTH_UNAVAILABLE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('UNLIMITED key has full access with 0 upstream calls and no rate-limit restrictions', async () => {
  const base = loadConfig();
  let authorizerCalls = 0;
  const cfg = {
    ...base,
    cache: { ttlMs: 0, maxEntries: 0 },
    rateLimit: { windowMs: 60000, max: 1 },
    auth: {
      requireLicenseKey: true,
      keyServerUrl: '',
      engineAuthSecret: '',
      keyVerifyTimeoutMs: 1000,
      cacheTtlMs: 300000,
      customAuthorizer: async () => {
        authorizerCalls += 1;
        return { authorized: false };
      },
    },
  };
  const engineManager = {
    isReady: () => true,
    getStatus: () => ({
      state: 'ready',
      ready: true,
      version: 'Stockfish 19',
      pinnedTag: 'sf_19',
      pinnedCommit: 'x',
    }),
    analyze: ({ requestedDepths }) =>
      Promise.resolve({
        bestmove: 'e2e4',
        ponder: 'e7e5',
        terminal: false,
        results: requestedDepths.map((d) => ({
          depth: d,
          bestmove: 'e2e4',
          evaluation: { type: 'cp', value: 0.3, rawCp: 30 },
          mate: null,
          pv: ['e2e4'],
        })),
      }),
  };
  const requestQueue = new RequestQueue(engineManager, cfg);
  const app = createApp({ config: cfg, engineManager, requestQueue });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // Three consecutive requests at max depth with UNLIMITED should all pass despite rateLimit.max=1
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${baseUrl}/v1/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-License-Key': 'UNLIMITED' },
        body: JSON.stringify({ fen: START_FEN, depths: [5, 10, 20] }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.quota.unlimited, true);
      assert.equal(data.quota.isPremium, true);
    }
    assert.equal(authorizerCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Pre-warmed license cache executes moves without waiting on slow upstream key server', async () => {
  const base = loadConfig();
  let upstreamDelayMs = 0;
  let warmCalls = 0;
  let remaining = 2;

  const cfg = {
    ...base,
    cache: { ttlMs: 0, maxEntries: 0 },
    auth: {
      requireLicenseKey: true,
      keyServerUrl: '',
      engineAuthSecret: '',
      keyVerifyTimeoutMs: 5000,
      cacheTtlMs: 300000,
      customAuthorizer: async ({ key, charge }) => {
        if (upstreamDelayMs > 0) {
          await new Promise((r) => setTimeout(r, upstreamDelayMs));
        }
        if (charge === false) {
          warmCalls += 1;
          return {
            authorized: key === 'MTEMP777',
            status: 200,
            tier: 'temporary',
            isPremium: false,
            moves_remain: remaining,
            maxAllowedDepth: 7,
          };
        }
        remaining = Math.max(0, remaining - 1);
        return {
          authorized: true,
          status: 200,
          tier: 'temporary',
          isPremium: false,
          moves_remain: remaining,
          maxAllowedDepth: 7,
        };
      },
    },
  };

  const engineManager = {
    isReady: () => true,
    getStatus: () => ({ state: 'ready', ready: true, version: 'Stockfish 19' }),
    analyze: ({ requestedDepths }) =>
      Promise.resolve({
        bestmove: 'e2e4',
        ponder: 'e7e5',
        terminal: false,
        results: requestedDepths.map((d) => ({
          depth: d,
          bestmove: 'e2e4',
          evaluation: { type: 'cp', value: 0.3, rawCp: 30 },
          mate: null,
          pv: ['e2e4'],
        })),
      }),
  };

  const app = createApp({
    config: cfg,
    engineManager,
    requestQueue: new RequestQueue(engineManager, cfg),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Pre-warm key before first move (does not charge a move)
    const warmRes = await fetch(`${baseUrl}/v1/auth/warm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'MTEMP777' },
      body: JSON.stringify({}),
    });
    assert.equal(warmRes.status, 200);
    const warmJson = await warmRes.json();
    assert.equal(warmJson.warmed, true);
    assert.equal(warmJson.quota.movesRemain, 2);
    assert.equal(warmCalls, 1);

    // 2. Simulate 1200ms slow upstream key server; cached moves must complete immediately (<250ms)
    upstreamDelayMs = 1200;

    const t0 = Date.now();
    const move1 = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'MTEMP777' },
      body: JSON.stringify({ fen: START_FEN, depth: 5 }),
    });
    const elapsed1 = Date.now() - t0;
    assert.equal(move1.status, 200);
    assert.equal((await move1.json()).quota.movesRemain, 1);
    assert.ok(elapsed1 < 250, `Expected non-blocking cached move1 (<250ms), got ${elapsed1}ms`);

    const fen2 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const t1 = Date.now();
    const move2 = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'MTEMP777' },
      body: JSON.stringify({ fen: fen2, depth: 7 }),
    });
    const elapsed2 = Date.now() - t1;
    assert.equal(move2.status, 200);
    assert.equal((await move2.json()).quota.movesRemain, 0);
    assert.ok(elapsed2 < 250, `Expected non-blocking cached move2 (<250ms), got ${elapsed2}ms`);

    // 3. Move 3 rejects immediately from cache (0 moves remaining)
    const fen3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const move3 = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-License-Key': 'MTEMP777' },
      body: JSON.stringify({ fen: fen3, depth: 5 }),
    });
    assert.equal(move3.status, 403);
    assert.equal((await move3.json()).error.code, 'MOVES_EXHAUSTED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
