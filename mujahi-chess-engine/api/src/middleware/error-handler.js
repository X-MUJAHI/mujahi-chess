'use strict';

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  // Handle Express JSON parser errors safely
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON request body.',
      },
    });
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds maximum allowed size.',
      },
    });
  }

  if (err?.code === 'CORS_FORBIDDEN') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'CORS_FORBIDDEN',
        message: 'Origin is not permitted by CORS policy.',
      },
    });
  }

  const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  const code = err?.code || 'INTERNAL_SERVER_ERROR';
  const safeMessage =
    statusCode >= 500 && code === 'INTERNAL_SERVER_ERROR'
      ? 'An internal server error occurred while processing the request.'
      : err?.message || 'Request failed.';

  if (statusCode >= 500 && code === 'INTERNAL_SERVER_ERROR') {
    console.error('[API Error]', err);
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: safeMessage,
    },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} does not exist.`,
    },
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
};
