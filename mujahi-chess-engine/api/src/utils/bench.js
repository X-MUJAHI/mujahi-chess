'use strict';

const { performance } = require('node:perf_hooks');
const { loadConfig } = require('../config');
const { EngineManager } = require('../engine/manager');

const BENCH_FENS = [
  {
    name: 'Starting Position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sideToMove: 'white',
  },
  {
    name: 'Sicilian Najdorf Middlegame',
    fen: 'r2qkb1r/1p1b1ppp/p1np1n2/4p3/4P3/1NN1BP2/PPPQ2PP/R3KB1R w KQkq - 2 10',
    sideToMove: 'white',
  },
];

async function runBenchmark() {
  const config = loadConfig();
  const engine = new EngineManager(config);
  await engine.start();

  try {
    console.log('=== MUJAHI Stockfish 19 Real Engine Benchmark ===');
    console.log(
      `Version: ${engine.engineIdentity.reportedName} | Threads=${config.engine.threads} | Hash=${config.engine.hashMb}MB`
    );

    for (const sample of BENCH_FENS) {
      // 1. Single iterative-deepening search collecting [5, 10, 15]
      const t0 = performance.now();
      const singlePass = await engine.analyze({
        fen: sample.fen,
        sideToMove: sample.sideToMove,
        targetDepth: 15,
        requestedDepths: [5, 10, 15],
        timeoutMs: 0,
      });
      const singleMs = Math.round(performance.now() - t0);
      const d15Single = singlePass.results[singlePass.results.length - 1];

      // 2. Three separate searches at depths 5, 10, 15
      const t1 = performance.now();
      let totalSeparateNodes = 0;
      for (const d of [5, 10, 15]) {
        const res = await engine.analyze({
          fen: sample.fen,
          sideToMove: sample.sideToMove,
          targetDepth: d,
          requestedDepths: [d],
          timeoutMs: 0,
        });
        totalSeparateNodes += res.results[0]?.nodes || 0;
      }
      const separateMs = Math.round(performance.now() - t1);

      const mem = process.memoryUsage();
      console.log(`\nPosition: ${sample.name}`);
      console.log(
        `  Single search [5,10,15]: wall=${singleMs}ms, bestmove=${singlePass.bestmove}, d15_nodes=${d15Single?.nodes}, d15_nps=${d15Single?.nps}`
      );
      console.log(
        `  Three searches (5,10,15): wall=${separateMs}ms, combined_nodes=${totalSeparateNodes}`
      );
      console.log(`  Node RSS=${(mem.rss / (1024 * 1024)).toFixed(1)} MB`);
    }
  } finally {
    await engine.shutdown();
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
