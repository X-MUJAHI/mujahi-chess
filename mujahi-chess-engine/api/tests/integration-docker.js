'use strict';

const assert = require('node:assert/strict');

const BASE_URL = process.env.MUJAHI_TEST_URL || 'http://127.0.0.1:3000';

async function waitForReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        const body = await res.json();
        if (body?.engine?.ready) return body;
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Timed out waiting for Stockfish 19 container /health readiness.');
}

async function runRealIntegrationTests() {
  console.log(`[Integration] Waiting for ${BASE_URL}/health ...`);
  const health = await waitForReady();
  assert.equal(health.api, 'online');
  assert.equal(health.engine.ready, true);
  assert.equal(health.engine.tag, 'sf_19');
  assert.equal(health.engine.commit, 'edb0d9db6731067ec50ce619ff372b463bc4dd5d');
  assert.match(health.engine.version, /Stockfish 19/i);
  console.log('[Integration] /health verified:', health.engine.version);

  // 1. /v1/engine metadata
  const engineRes = await fetch(`${BASE_URL}/v1/engine`);
  assert.equal(engineRes.status, 200);
  const engineMeta = await engineRes.json();
  assert.equal(engineMeta.success, true);
  assert.ok(Array.isArray(engineMeta.supportedOptions) && engineMeta.supportedOptions.length > 0);
  console.log(`[Integration] /v1/engine verified (${engineMeta.supportedOptions.length} real UCI options).`);

  // 2. Real Stockfish 19 analysis with multi-depth single search [5, 10, 15]
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const analyzeRes = await fetch(`${BASE_URL}/v1/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Session-Id': 'ci-session-1',
    },
    body: JSON.stringify({
      fen: startFen,
      depths: [5, 10, 15],
    }),
  });
  assert.equal(analyzeRes.status, 200);
  const analysis = await analyzeRes.json();
  assert.equal(analysis.success, true);
  assert.equal(analysis.results.length, 3);
  assert.deepEqual(
    analysis.results.map((r) => r.depth),
    [5, 10, 15]
  );
  assert.match(analysis.bestmove, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
  assert.equal(analysis.results[2].evaluation.perspective, 'white');
  console.log(
    `[Integration] Real Stockfish 19 [5,10,15] bestmove=${analysis.bestmove}, eval=${analysis.results[2].evaluation.value}, nodes=${analysis.results[2].nodes}`
  );

  // 3. Real SSE streaming endpoint
  const sseRes = await fetch(`${BASE_URL}/v1/analyze/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fen: 'r2qkb1r/1p1b1ppp/p1np1n2/4p3/4P3/1NN1BP2/PPPQ2PP/R3KB1R w KQkq - 2 10',
      depths: [5, 10, 12],
      clientSessionId: 'ci-session-sse',
    }),
  });
  assert.equal(sseRes.status, 200);
  const sseBody = await sseRes.text();
  assert.match(sseBody, /event: snapshot/);
  assert.match(sseBody, /event: complete/);
  console.log('[Integration] SSE progressive depth streaming verified.');

  // 4. Reject invalid semantic FEN cleanly without crashing engine
  const invalidRes = await fetch(`${BASE_URL}/v1/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fen: '4k3/8/8/8/8/8/8/4R2K w - - 0 1',
      depth: 10,
    }),
  });
  assert.equal(invalidRes.status, 400);

  // 5. Verify engine remains healthy after invalid request
  const postHealth = await fetch(`${BASE_URL}/health`).then((r) => r.json());
  assert.equal(postHealth.engine.ready, true);
  assert.equal(postHealth.engine.restarts, 0);
  console.log('[Integration] All real-engine Docker integration checks passed!');
}

runRealIntegrationTests().catch((err) => {
  console.error('[Integration] FAILED:', err);
  process.exit(1);
});
