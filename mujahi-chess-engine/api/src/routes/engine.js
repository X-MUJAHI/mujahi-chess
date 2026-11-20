'use strict';

const express = require('express');

function createEngineRouter(engineManager, config) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const status = engineManager.getStatus();
    res.json({
      success: true,
      engine: config.pinnedStockfish.brandName,
      version: status.version,
      tag: status.pinnedTag,
      commit: status.pinnedCommit,
      nnueArchitecture: status.nnueArchitecture,
      defaultNet: status.defaultNet,
      apiVersion: config.apiVersion,
      endpoints: [
        'GET /health',
        'GET /v1/engine',
        'POST /v1/analyze',
        'POST /v1/analyze/stream',
        'GET /v1/analyze/stream',
      ],
      configuration: {
        threads: config.engine.threads,
        hashMb: config.engine.hashMb,
        defaultDepth: config.engine.defaultDepth,
        maxDepth: config.engine.maxDepth,
        multiPv: config.engine.multiPv,
        maxQueue: config.engine.maxQueue,
        defaultTimeoutMs: config.engine.timeoutMs,
        maxTimeoutMs: config.engine.maxTimeoutMs,
      },
      supportedOptions: status.supportedOptions,
      ready: status.ready,
    });
  });

  return router;
}

module.exports = {
  createEngineRouter,
};
