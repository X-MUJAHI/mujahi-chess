'use strict';

const { loadConfig } = require('./config');
const { EngineManager } = require('./engine/manager');
const { RequestQueue } = require('./queue/request-queue');
const { createApp } = require('./app');

async function main() {
  const config = loadConfig();
  const engineManager = new EngineManager(config);
  const requestQueue = new RequestQueue(engineManager, config);
  const app = createApp({ config, engineManager, requestQueue });

  try {
    await engineManager.start();
  } catch (err) {
    console.error(`[Server] Initial Stockfish startup failed: ${err.message}`);
    // Keep HTTP server alive so /health returns 503 with structured diagnostics
    // and lazy recovery can re-attempt start on demand.
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `[Server] MUJAHI Chess Engine API listening on http://${config.host}:${config.port}`
    );
  });

  let shuttingDown = false;
  async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] Received ${signal}. Shutting down cleanly...`);

    requestQueue.cancelAll('Server shutting down.');

    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 4000).unref?.();
    });

    await engineManager.shutdown();
    console.log('[Server] Shutdown complete.');
    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
