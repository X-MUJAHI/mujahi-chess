'use strict';

const express = require('express');

function createHealthRouter(engineManager, requestQueue, config) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const engineStatus = engineManager.getStatus();
    const queueStats = requestQueue.getStats();
    const mem = process.memoryUsage();
    const healthy = engineStatus.ready || engineStatus.state === 'starting' || engineStatus.state === 'restarting';

    const payload = {
      status: engineStatus.ready ? 'ok' : healthy ? 'initializing' : 'error',
      api: 'online',
      engine: {
        name: config.pinnedStockfish.brandName,
        status: engineStatus.state,
        ready: engineStatus.ready,
        busy: engineStatus.busy,
        version: engineStatus.version,
        tag: engineStatus.pinnedTag,
        commit: engineStatus.pinnedCommit,
        nnueArchitecture: engineStatus.nnueArchitecture,
        defaultNet: engineStatus.defaultNet,
        restarts: engineStatus.restarts,
      },
      queue: queueStats,
      memory: {
        rssMb: Number((mem.rss / (1024 * 1024)).toFixed(1)),
        heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
        configuredHashMb: config.engine.hashMb,
      },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    res.status(healthy ? 200 : 503).json(payload);
  });

  return router;
}

module.exports = {
  createHealthRouter,
};
