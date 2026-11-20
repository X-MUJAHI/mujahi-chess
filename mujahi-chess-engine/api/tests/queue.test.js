'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { RequestQueue, QueueFullError } = require('../src/queue/request-queue');
const { EngineCancelledError } = require('../src/engine/manager');

function createStubEngineManager(delayMs = 35) {
  let activeAborted = false;
  const calls = [];

  return {
    calls,
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
    abortActiveSearch() {
      activeAborted = true;
      return true;
    },
    analyze({ fen, targetDepth, requestedDepths, onDepthSnapshot }) {
      activeAborted = false;
      calls.push({ fen, targetDepth, requestedDepths });
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (activeAborted) {
            reject(new EngineCancelledError('Aborted during search'));
            return;
          }
          const results = [...requestedDepths]
            .sort((a, b) => a - b)
            .map((d) => {
              const snap = {
                depth: d,
                bestmove: 'e2e4',
                ponder: 'e7e5',
                evaluation: { type: 'cp', value: 0.3, rawCp: 30, perspective: 'white', bound: 'exact' },
                mate: null,
                bound: 'exact',
                pv: ['e2e4', 'e7e5'],
                nodes: d * 1000,
                nps: 50000,
                time: 20,
                terminal: false,
              };
              onDepthSnapshot?.(snap);
              return snap;
            });
          resolve({
            bestmove: 'e2e4',
            ponder: 'e7e5',
            terminal: false,
            results,
          });
        }, delayMs);
      });
    },
  };
}

const FEN_1 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_2 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const FEN_3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
const FEN_4 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

test('enforces bounded queue limit and rejects overflow with QueueFullError', async () => {
  const base = loadConfig();
  const cfg = {
    ...base,
    engine: { ...base.engine, maxQueue: 2 },
    cache: { ttlMs: 0, maxEntries: 0 },
  };
  const stub = createStubEngineManager(50);
  const queue = new RequestQueue(stub, cfg);

  const p1 = queue.enqueue({ fen: FEN_1, sideToMove: 'white', requestedDepths: [10], clientSessionId: 'c1' });
  const p2 = queue.enqueue({ fen: FEN_2, sideToMove: 'black', requestedDepths: [10], clientSessionId: 'c2' });
  const p3 = queue.enqueue({ fen: FEN_3, sideToMove: 'white', requestedDepths: [10], clientSessionId: 'c3' });

  // Active = 1, waiting = 2 (maxQueue=2). Next distinct FEN must fail with QueueFullError
  await assert.rejects(
    queue.enqueue({ fen: FEN_4, sideToMove: 'black', requestedDepths: [10], clientSessionId: 'c4' }),
    (err) => err instanceof QueueFullError && err.statusCode === 503
  );

  await Promise.all([p1, p2, p3]);
});

test('deduplicates identical FEN requests across clients and isolates cancellation', async () => {
  const base = loadConfig();
  const cfg = { ...base, cache: { ttlMs: 0, maxEntries: 0 } };
  const stub = createStubEngineManager(40);
  const queue = new RequestQueue(stub, cfg);

  const acA = new AbortController();
  const pA = queue.enqueue({
    fen: FEN_1,
    sideToMove: 'white',
    requestedDepths: [5, 10],
    clientSessionId: 'client-a',
    signal: acA.signal,
  });
  const pB = queue.enqueue({
    fen: FEN_1,
    sideToMove: 'white',
    requestedDepths: [10],
    clientSessionId: 'client-b',
  });

  // Client A aborts; Client B must still complete normally on the single shared search
  setTimeout(() => acA.abort(), 10);

  await assert.rejects(pA, (err) => err instanceof EngineCancelledError);
  const resB = await pB;
  assert.equal(resB.bestmove, 'e2e4');
  assert.equal(stub.calls.length, 1);
});

test('client session new FEN cancels only that client obsolete jobs without disrupting other clients', async () => {
  const base = loadConfig();
  const cfg = { ...base, cache: { ttlMs: 0, maxEntries: 0 } };
  const stub = createStubEngineManager(40);
  const queue = new RequestQueue(stub, cfg);

  // Client B owns active search on FEN_1
  const pB = queue.enqueue({
    fen: FEN_1,
    sideToMove: 'white',
    requestedDepths: [15],
    clientSessionId: 'client-b',
  });
  // Client A queues FEN_2
  const pA_old = queue.enqueue({
    fen: FEN_2,
    sideToMove: 'black',
    requestedDepths: [15],
    clientSessionId: 'client-a',
  });
  // Client A quickly moves to FEN_3 -> cancels pA_old ONLY; pB is untouched!
  const pA_new = queue.enqueue({
    fen: FEN_3,
    sideToMove: 'white',
    requestedDepths: [15],
    clientSessionId: 'client-a',
  });

  await assert.rejects(pA_old, (err) => err instanceof EngineCancelledError);
  const [resB, resA] = await Promise.all([pB, pA_new]);
  assert.equal(resB.fen, FEN_1);
  assert.equal(resA.fen, FEN_3);
});

test('latest-position-first scheduling runs newest queued position before older queued positions', async () => {
  const base = loadConfig();
  const cfg = { ...base, cache: { ttlMs: 0, maxEntries: 0 } };
  const stub = createStubEngineManager(25);
  const queue = new RequestQueue(stub, cfg);

  const p1 = queue.enqueue({ fen: FEN_1, sideToMove: 'white', requestedDepths: [10], clientSessionId: 'c1' });
  const p2 = queue.enqueue({ fen: FEN_2, sideToMove: 'black', requestedDepths: [10], clientSessionId: 'c2' });
  const p3 = queue.enqueue({ fen: FEN_3, sideToMove: 'white', requestedDepths: [10], clientSessionId: 'c3' });

  await Promise.all([p1, p2, p3]);
  // FEN_1 ran immediately, then LIFO picked FEN_3 before FEN_2
  assert.deepEqual(
    stub.calls.map((c) => c.fen),
    [FEN_1, FEN_3, FEN_2]
  );
});
