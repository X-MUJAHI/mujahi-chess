'use strict';

const express = require('express');
const {
  validateAnalyzeBody,
  validateAnalyzeQuery,
  validateSoftMistakesBody,
} = require('../middleware/validation');
const { createLicenseMiddleware } = require('../middleware/license-auth');
const { runSoftMistakeScan } = require('../utils/soft-mistakes');

function formatSseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createAnalyzeRouter(engineManager, requestQueue, config, licenseAuth = null) {
  const router = express.Router();
  const authMiddleware = licenseAuth || createLicenseMiddleware(config);
  const requireEngineLicense = (feature) => authMiddleware.requireEngineLicense(feature);

  // Standard synchronous JSON analysis endpoint
  router.post(
    '/',
    validateAnalyzeBody(config),
    requireEngineLicense('analyze'),
    async (req, res, next) => {
    const abortController = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    };
    res.on('close', onClose);

    try {
      const { fen, sideToMove, requestedDepths, clientSessionId, timeoutMs } =
        req.validatedAnalysis;

      const analysis = await requestQueue.enqueue({
        fen,
        sideToMove,
        requestedDepths,
        clientSessionId,
        timeoutMs,
        signal: abortController.signal,
      });

      if (res.writableEnded || abortController.signal.aborted) return;

      const status = engineManager.getStatus();
      res.json({
        success: true,
        engine: config.pinnedStockfish.brandName,
        version: status.version,
        tag: status.pinnedTag,
        commit: status.pinnedCommit,
        fen: analysis.fen,
        sideToMove: analysis.sideToMove,
        bestmove: analysis.bestmove,
        ponder: analysis.ponder,
        terminal: analysis.terminal,
        cached: analysis.cached,
        deduplicated: analysis.deduplicated,
        results: analysis.results,
        ...(req.engineAuth ? { quota: req.engineAuth } : {}),
      });
    } catch (err) {
      if (!res.writableEnded && !abortController.signal.aborted) {
        next(err);
      }
    } finally {
      res.off('close', onClose);
    }
  });

  // Shared progressive SSE streaming handler for POST /v1/analyze/stream and GET /v1/analyze/stream
  async function handleSseStream(req, res) {
    const abortController = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    };
    res.on('close', onClose);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const { fen, sideToMove, requestedDepths, clientSessionId, timeoutMs } =
      req.validatedAnalysis;

    res.write(
      formatSseEvent('started', {
        fen,
        sideToMove,
        depths: requestedDepths,
        clientSessionId,
      })
    );

    try {
      const analysis = await requestQueue.enqueue({
        fen,
        sideToMove,
        requestedDepths,
        clientSessionId,
        timeoutMs,
        signal: abortController.signal,
        onDepthSnapshot: (snapshot) => {
          if (!res.writableEnded && !abortController.signal.aborted) {
            res.write(formatSseEvent('snapshot', snapshot));
          }
        },
      });

      if (!res.writableEnded && !abortController.signal.aborted) {
        const status = engineManager.getStatus();
        res.write(
          formatSseEvent('complete', {
            success: true,
            engine: config.pinnedStockfish.brandName,
            version: status.version,
            tag: status.pinnedTag,
            commit: status.pinnedCommit,
            fen: analysis.fen,
            sideToMove: analysis.sideToMove,
            bestmove: analysis.bestmove,
            ponder: analysis.ponder,
            terminal: analysis.terminal,
            cached: analysis.cached,
            deduplicated: analysis.deduplicated,
            results: analysis.results,
            ...(req.engineAuth ? { quota: req.engineAuth } : {}),
          })
        );
        res.end();
      }
    } catch (err) {
      if (!res.writableEnded && !abortController.signal.aborted) {
        res.write(
          formatSseEvent('error', {
            success: false,
            error: {
              code: err?.code || 'INTERNAL_SERVER_ERROR',
              message: err?.message || 'Streaming analysis failed.',
            },
          })
        );
        res.end();
      }
    } finally {
      res.off('close', onClose);
    }
  }

  router.post(
    '/stream',
    validateAnalyzeBody(config),
    requireEngineLicense('analyze'),
    handleSseStream
  );
  router.get(
    '/stream',
    validateAnalyzeQuery(config),
    requireEngineLicense('analyze'),
    handleSseStream
  );

  // On-demand 2-stage soft-mistake scan (MultiPV 24 @ depth 7 -> searchmoves @ depth 10 or license maxAllowedDepth)
  router.post(
    '/soft-mistakes',
    validateSoftMistakesBody(config),
    requireEngineLicense('soft-mistakes'),
    async (req, res, next) => {
      const abortController = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      };
      res.on('close', onClose);

      try {
        const { fen, sideToMove, minDropCp, maxDropCp, maxResults, timeoutMs } =
          req.validatedSoftMistakes;
        const maxAllowed = req.engineAuth?.maxAllowedDepth || config.engine.maxDepth;
        const stage2Depth = Math.min(10, config.engine.maxDepth, maxAllowed);
        const stage1Depth = Math.min(7, stage2Depth);

        const scan = await requestQueue.enqueueTask({
          timeoutMs,
          signal: abortController.signal,
          task: ({ engineManager: em, timeoutMs: effectiveTimeout }) =>
            runSoftMistakeScan({
              fen,
              sideToMove,
              minDropCp,
              maxDropCp,
              maxResults,
              stage1Depth,
              stage2Depth,
              multiPvLimit: 24,
              runMultiPv: ({ targetDepth, multiPv, searchMoves }) =>
                em.analyzeMultiPv({
                  fen,
                  sideToMove,
                  targetDepth,
                  multiPv,
                  searchMoves,
                  timeoutMs: effectiveTimeout,
                  signal: abortController.signal,
                }),
            }),
        });

        if (res.writableEnded || abortController.signal.aborted) return;

        const status = engineManager.getStatus();
        res.json({
          success: true,
          engine: config.pinnedStockfish.brandName,
          version: status.version,
          tag: status.pinnedTag,
          fen,
          sideToMove,
          minDropCp,
          maxDropCp,
          maxResults,
          ...scan,
          ...(req.engineAuth ? { quota: req.engineAuth } : {}),
        });
    } catch (err) {
      if (!res.writableEnded && !abortController.signal.aborted) {
        next(err);
      }
    } finally {
      res.off('close', onClose);
    }
  });

  return router;
}

module.exports = {
  createAnalyzeRouter,
};
