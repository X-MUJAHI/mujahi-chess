'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { createHealthRouter } = require('./routes/health');
const { createEngineRouter } = require('./routes/engine');
const { createAnalyzeRouter } = require('./routes/analyze');
const { createAnalysisRateLimiter } = require('./middleware/rate-limit');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');

function createApp({ config, engineManager, requestQueue }) {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // Explicit CORS policy: Vercel frontend origins allowed explicitly;
  // requests without an Origin header (curl, healthchecks, MV3 service workers) are permitted.
  // Arbitrary third-party web pages (including chess.com content scripts) are blocked when allowlist is set.
  const allowedOrigins = new Set(config.corsAllowedOrigins);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          return callback(null, true);
        }
        if (allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
          return callback(null, true);
        }
        const err = new Error(`Origin ${origin} is not allowed by CORS.`);
        err.code = 'CORS_FORBIDDEN';
        return callback(err);
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Client-Session-Id'],
      maxAge: 600,
    })
  );

  app.use(express.json({ limit: '16kb' }));

  app.use('/health', createHealthRouter(engineManager, requestQueue, config));
  app.use('/v1/engine', createEngineRouter(engineManager, config));

  const analyzeLimiter = createAnalysisRateLimiter(config);
  app.use('/v1/analyze', analyzeLimiter, createAnalyzeRouter(engineManager, requestQueue, config));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
};
