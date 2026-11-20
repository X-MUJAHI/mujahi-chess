'use strict';

const rateLimit = require('express-rate-limit');

function createAnalysisRateLimiter(config) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: `Too many analysis requests. Limit is ${config.rateLimit.max} requests per ${Math.round(
            config.rateLimit.windowMs / 1000
          )}s.`,
        },
      });
    },
  });
}

module.exports = {
  createAnalysisRateLimiter,
};
