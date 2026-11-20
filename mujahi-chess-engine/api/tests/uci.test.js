'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { loadConfig } = require('../src/config');
const {
  EngineManager,
  EngineTimeoutError,
  EngineCrashedError,
  EngineCancelledError,
} = require('../src/engine/manager');

/**
 * Lightweight deterministic UCI pipe harness for testing EngineManager state
 * machine transitions (handshake, multi-depth collection, stop, timeout, crash).
 * Note: Real native Stockfish 19 verification runs separately in integration-docker.js.
 */
function createHarnessProcess({ hangOnStop = false, crashOnGo = false } = {}) {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.commands = [];

  proc.kill = (sig = 'SIGTERM') => {
    proc.killed = true;
    proc.signalCode = sig;
    proc.exitCode = 0;
    queueMicrotask(() => proc.emit('exit', 0, sig));
  };

  let buf = '';
  let searchTimer = null;
  proc.stdin.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const raw of lines) {
      const cmd = raw.trim();
      if (!cmd) continue;
      proc.commands.push(cmd);

      if (cmd === 'uci') {
        proc.stdout.write('id name Stockfish 19\n');
        proc.stdout.write('id author The Stockfish developers\n');
        proc.stdout.write('option name Threads type spin default 1 min 1 max 1024\n');
        proc.stdout.write('option name Hash type spin default 16 min 1 max 33554432\n');
        proc.stdout.write('option name MultiPV type spin default 1 min 1 max 256\n');
        proc.stdout.write('uciok\n');
      } else if (cmd === 'isready') {
        proc.stdout.write('readyok\n');
      } else if (cmd.startsWith('go depth ')) {
        const depth = Number.parseInt(cmd.split(' ')[2], 10);
        if (crashOnGo) {
          setTimeout(() => {
            proc.exitCode = 139;
            proc.emit('exit', 139, 'SIGSEGV');
          }, 15);
          continue;
        }
        if (depth >= 15) {
          setTimeout(() => {
            if (proc.killed) return;
            proc.stdout.write('info depth 5 score cp 20 nodes 500 nps 50000 time 10 pv e2e4 e7e5\n');
            proc.stdout.write('info depth 10 score cp 28 nodes 5000 nps 100000 time 50 pv e2e4 e7e5 g1f3\n');
            proc.stdout.write('info depth 15 score cp 34 nodes 30000 nps 150000 time 200 pv e2e4 e7e5 g1f3 b8c6\n');
            proc.stdout.write('bestmove e2e4 ponder e7e5\n');
          }, 25);
        } else {
          // Simulate slower deeper search so timeout / stop can be exercised
          searchTimer = setTimeout(() => {
            if (proc.killed) return;
            proc.stdout.write(`info depth ${depth} score cp 15 nodes 1000 nps 10000 time 100 pv d2d4 d7d5\n`);
            proc.stdout.write('bestmove d2d4 ponder d7d5\n');
          }, 250);
        }
      } else if (cmd === 'stop') {
        if (searchTimer) clearTimeout(searchTimer);
        if (!hangOnStop) {
          setTimeout(() => {
            if (!proc.killed) {
              proc.stdout.write('bestmove e2e4 ponder e7e5\n');
            }
          }, 10);
        }
      } else if (cmd === 'quit') {
        if (searchTimer) clearTimeout(searchTimer);
        proc.exitCode = 0;
        proc.emit('exit', 0, null);
      }
    }
  });

  return proc;
}

test('initializes Stockfish UCI, sets configured options, and collects multi-depth snapshots in one search', async () => {
  const cfg = loadConfig();
  let harness = null;
  const manager = new EngineManager(cfg, {
    spawnFn: () => {
      harness = createHarnessProcess();
      return harness;
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  await manager.start();
  assert.equal(manager.isReady(), true);
  assert.ok(harness.commands.includes('setoption name Threads value 1'));
  assert.ok(harness.commands.includes(`setoption name Hash value ${cfg.engine.hashMb}`));
  assert.ok(harness.commands.includes('setoption name MultiPV value 1'));

  const streamed = [];
  const res = await manager.analyze({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sideToMove: 'white',
    targetDepth: 15,
    requestedDepths: [5, 10, 15],
    onDepthSnapshot: (snap) => streamed.push(snap.depth),
  });

  assert.deepEqual(streamed, [5, 10, 15]);
  assert.equal(res.results.length, 3);
  assert.equal(res.bestmove, 'e2e4');
  // Exactly one `go depth 15` command sent
  assert.equal(harness.commands.filter((c) => c.startsWith('go depth')).length, 1);

  await manager.shutdown();
});

test('sends stop and waits for bestmove on cancellation', async () => {
  const cfg = loadConfig();
  let harness = null;
  const manager = new EngineManager(cfg, {
    spawnFn: () => {
      harness = createHarnessProcess();
      return harness;
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  await manager.start();

  const ac = new AbortController();
  const promise = manager.analyze({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sideToMove: 'white',
    targetDepth: 12,
    requestedDepths: [12],
    signal: ac.signal,
  });

  setTimeout(() => ac.abort(), 20);
  await assert.rejects(promise, (err) => err instanceof EngineCancelledError);
  assert.ok(harness.commands.includes('stop'));
  assert.equal(manager.state, 'ready');

  await manager.shutdown();
});

test('handles configurable timeout and restarts safely if stop hangs', async () => {
  const base = loadConfig();
  const cfg = {
    ...base,
    engine: { ...base.engine, stopTimeoutMs: 60 },
  };
  let spawnCount = 0;
  const manager = new EngineManager(cfg, {
    spawnFn: () => {
      spawnCount += 1;
      return createHarnessProcess({ hangOnStop: spawnCount === 1 });
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  await manager.start();

  const promise = manager.analyze({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sideToMove: 'white',
    targetDepth: 12,
    requestedDepths: [12],
    timeoutMs: 30,
  });

  await assert.rejects(promise, (err) => err instanceof EngineTimeoutError);
  assert.equal(spawnCount, 2);
  assert.equal(manager.state, 'ready');

  await manager.shutdown();
});

test('rejects active search on crash and recovers with safe restart', async () => {
  const cfg = loadConfig();
  let spawnCount = 0;
  const manager = new EngineManager(cfg, {
    spawnFn: () => {
      spawnCount += 1;
      return createHarnessProcess({ crashOnGo: spawnCount === 1 });
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  await manager.start();

  await assert.rejects(
    manager.analyze({
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      sideToMove: 'white',
      targetDepth: 15,
      requestedDepths: [15],
    }),
    (err) => err instanceof EngineCrashedError
  );

  // Wait briefly for background restart to finish
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(manager.state, 'ready');
  assert.equal(manager.restartsCount, 1);

  await manager.shutdown();
});
