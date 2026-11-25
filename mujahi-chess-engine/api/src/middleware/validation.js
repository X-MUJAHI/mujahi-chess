'use strict';

const { validateFen } = require('../utils/fen');

const ALLOWED_ANALYZE_FIELDS = new Set([
  'fen',
  'depth',
  'depths',
  'clientSessionId',
  'timeoutMs',
]);

class ValidationError extends Error {
  constructor(message, code = 'INVALID_REQUEST') {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.code = code;
  }
}

function parseClientSessionId(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new ValidationError('clientSessionId must be a string.', 'INVALID_CLIENT_SESSION');
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 64 || !/^[A-Za-z0-9_.:-]+$/.test(trimmed)) {
    throw new ValidationError(
      'clientSessionId must be 1-64 characters matching [A-Za-z0-9_.:-].',
      'INVALID_CLIENT_SESSION'
    );
  }
  return trimmed;
}

function parseRequestedDepths(depthInput, depthsInput, config) {
  const maxDepth = config.engine.maxDepth;
  const defaultDepth = config.engine.defaultDepth;

  if (depthInput !== undefined && depthsInput !== undefined) {
    throw new ValidationError('Provide either "depth" or "depths", not both.', 'INVALID_DEPTH');
  }

  if (depthsInput !== undefined) {
    if (!Array.isArray(depthsInput) || depthsInput.length === 0) {
      throw new ValidationError('"depths" must be a non-empty array of integers.', 'INVALID_DEPTH');
    }
    if (depthsInput.length > 10) {
      throw new ValidationError('"depths" cannot contain more than 10 entries.', 'INVALID_DEPTH');
    }
    const parsed = depthsInput.map((d) => {
      if (!Number.isInteger(d) || d < 1 || d > maxDepth) {
        throw new ValidationError(
          `Every depth in "depths" must be an integer between 1 and ${maxDepth}.`,
          'INVALID_DEPTH'
        );
      }
      return d;
    });
    return [...new Set(parsed)].sort((a, b) => a - b);
  }

  if (depthInput !== undefined) {
    if (!Number.isInteger(depthInput) || depthInput < 1 || depthInput > maxDepth) {
      throw new ValidationError(
        `"depth" must be an integer between 1 and ${maxDepth}.`,
        'INVALID_DEPTH'
      );
    }
    return [depthInput];
  }

  return [defaultDepth];
}

function parseTimeoutMs(rawTimeout, config) {
  if (rawTimeout === undefined) {
    return config.engine.timeoutMs;
  }
  if (!Number.isInteger(rawTimeout)) {
    throw new ValidationError('"timeoutMs" must be an integer.', 'INVALID_TIMEOUT');
  }
  if (rawTimeout === 0) {
    if (config.engine.timeoutMs === 0) return 0;
    throw new ValidationError(
      'Disabling timeout (timeoutMs=0) is not permitted under current server policy.',
      'INVALID_TIMEOUT'
    );
  }
  if (rawTimeout < 1000 || rawTimeout > config.engine.maxTimeoutMs) {
    throw new ValidationError(
      `"timeoutMs" must be between 1000 and ${config.engine.maxTimeoutMs}.`,
      'INVALID_TIMEOUT'
    );
  }
  return rawTimeout;
}

function validateAnalyzeBody(config) {
  return (req, res, next) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('Request body must be a JSON object.', 'INVALID_BODY');
      }

      for (const key of Object.keys(body)) {
        if (!ALLOWED_ANALYZE_FIELDS.has(key)) {
          throw new ValidationError(
            `Unsupported parameter "${key}". Allowed parameters: fen, depth, depths, clientSessionId, timeoutMs.`,
            'UNSUPPORTED_PARAMETER'
          );
        }
      }

      const fenResult = validateFen(body.fen);
      if (!fenResult.valid) {
        throw new ValidationError(fenResult.error, 'INVALID_FEN');
      }

      const requestedDepths = parseRequestedDepths(body.depth, body.depths, config);
      const headerSession = req.get('x-client-session-id');
      const clientSessionId = parseClientSessionId(body.clientSessionId ?? headerSession);
      const timeoutMs = parseTimeoutMs(body.timeoutMs, config);

      req.validatedAnalysis = {
        fen: fenResult.fen,
        sideToMove: fenResult.sideToMove,
        requestedDepths,
        clientSessionId,
        timeoutMs,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

function validateAnalyzeQuery(config) {
  return (req, res, next) => {
    try {
      const allowedQuery = new Set(['fen', 'depth', 'depths', 'clientSessionId', 'timeoutMs']);
      for (const key of Object.keys(req.query)) {
        if (!allowedQuery.has(key)) {
          throw new ValidationError(`Unsupported query parameter "${key}".`, 'UNSUPPORTED_PARAMETER');
        }
      }

      const fenResult = validateFen(req.query.fen);
      if (!fenResult.valid) {
        throw new ValidationError(fenResult.error, 'INVALID_FEN');
      }

      const depthInput =
        req.query.depth !== undefined ? Number(req.query.depth) : undefined;
      const depthsInput =
        req.query.depths !== undefined
          ? String(req.query.depths)
              .split(',')
              .map((v) => Number(v.trim()))
          : undefined;
      const timeoutInput =
        req.query.timeoutMs !== undefined ? Number(req.query.timeoutMs) : undefined;

      const requestedDepths = parseRequestedDepths(depthInput, depthsInput, config);
      const headerSession = req.get('x-client-session-id');
      const clientSessionId = parseClientSessionId(req.query.clientSessionId ?? headerSession);
      const timeoutMs = parseTimeoutMs(timeoutInput, config);

      req.validatedAnalysis = {
        fen: fenResult.fen,
        sideToMove: fenResult.sideToMove,
        requestedDepths,
        clientSessionId,
        timeoutMs,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

const ALLOWED_SOFT_MISTAKE_FIELDS = new Set([
  'fen',
  'minDropCp',
  'maxDropCp',
  'maxResults',
  'timeoutMs',
]);

function validateSoftMistakesBody(config) {
  return (req, res, next) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('Request body must be a JSON object.', 'INVALID_BODY');
      }

      for (const key of Object.keys(body)) {
        if (!ALLOWED_SOFT_MISTAKE_FIELDS.has(key)) {
          throw new ValidationError(
            `Unsupported parameter "${key}". Allowed parameters: fen, minDropCp, maxDropCp, maxResults, timeoutMs.`,
            'UNSUPPORTED_PARAMETER'
          );
        }
      }

      const fenResult = validateFen(body.fen);
      if (!fenResult.valid) {
        throw new ValidationError(fenResult.error, 'INVALID_FEN');
      }

      const minDropCp =
        body.minDropCp === undefined ? 25 : Number(body.minDropCp);
      const maxDropCp =
        body.maxDropCp === undefined ? 85 : Number(body.maxDropCp);
      const maxResults =
        body.maxResults === undefined ? 3 : Number(body.maxResults);

      if (!Number.isInteger(minDropCp) || minDropCp < 10 || minDropCp > 300) {
        throw new ValidationError('"minDropCp" must be an integer between 10 and 300.', 'INVALID_RANGE');
      }
      if (!Number.isInteger(maxDropCp) || maxDropCp < 20 || maxDropCp > 400 || maxDropCp < minDropCp) {
        throw new ValidationError(
          '"maxDropCp" must be an integer between 20 and 400 and >= minDropCp.',
          'INVALID_RANGE'
        );
      }
      if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 5) {
        throw new ValidationError('"maxResults" must be an integer between 1 and 5.', 'INVALID_COUNT');
      }

      const timeoutMs = parseTimeoutMs(body.timeoutMs, config);

      req.validatedSoftMistakes = {
        fen: fenResult.fen,
        sideToMove: fenResult.sideToMove,
        minDropCp,
        maxDropCp,
        maxResults,
        timeoutMs,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  ValidationError,
  validateAnalyzeBody,
  validateAnalyzeQuery,
  validateSoftMistakesBody,
};
