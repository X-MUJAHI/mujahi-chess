'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { createHealthRouter } = require('./routes/health');
const { createEngineRouter } = require('./routes/engine');
const { createAnalyzeRouter } = require('./routes/analyze');
const { createAnalysisRateLimiter } = require('./middleware/rate-limit');
const { createLicenseMiddleware } = require('./middleware/license-auth');
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

  // Explicit CORS policy:
  // - Requests without an Origin header (curl, Render healthchecks) are permitted.
  // - Configured frontend origins (CORS_ALLOWED_ORIGINS, e.g. Vercel) are permitted.
  // - MV3/WebExtension origins (chrome-extension://..., moz-extension://...) are permitted
  //   when CORS_ALLOW_EXTENSIONS is enabled, because Chromium service workers send
  //   Origin: chrome-extension://<id> on cross-origin POST requests.
  // - Arbitrary third-party web pages (e.g. https://www.chess.com) remain blocked.
  const allowedOrigins = new Set(config.corsAllowedOrigins);
  const isExtensionOrigin = (origin) =>
    config.corsAllowExtensions !== false &&
    (/^chrome-extension:\/\/[a-p]{32}$/.test(origin) || /^moz-extension:\/\/[0-9a-f-]+$/i.test(origin));

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          return callback(null, true);
        }
        if (allowedOrigins.size === 0 || allowedOrigins.has(origin) || isExtensionOrigin(origin)) {
          return callback(null, true);
        }
        const err = new Error(`Origin ${origin} is not allowed by CORS.`);
        err.code = 'CORS_FORBIDDEN';
        return callback(err);
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Client-Session-Id', 'X-License-Key', 'Authorization'],
      exposedHeaders: ['X-Moves-Remaining'],
      maxAge: 600,
    })
  );

  app.use(express.json({ limit: '16kb' }));

  const licenseAuth = createLicenseMiddleware(config);

  app.use('/health', createHealthRouter(engineManager, requestQueue, config));
  app.use('/v1/engine', createEngineRouter(engineManager, config));
  app.post('/v1/auth/warm', licenseAuth.warmEngineLicense);

  const analyzeLimiter = createAnalysisRateLimiter(config);
  app.use(
    '/v1/analyze',
    analyzeLimiter,
    createAnalyzeRouter(engineManager, requestQueue, config, licenseAuth)
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
};
