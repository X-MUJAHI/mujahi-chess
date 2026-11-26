'use strict';

const KEY_REGEX = /^M[A-Z0-9]{7}$/;
const MASTER_UNLIMITED_KEY = 'UNLIMITED';
const FEN_DEDUP_TTL_MS = 60_000;
const MAX_LICENSE_CACHE_ENTRIES = 1000;
const MAX_FEN_DEDUP_ENTRIES = 2000;

function isValidKeyFormat(key) {
  return key === MASTER_UNLIMITED_KEY || KEY_REGEX.test(key);
}

function extractLicenseKey(req) {
  const headerKey = req.get('x-license-key');
  if (headerKey && String(headerKey).trim()) {
    return String(headerKey).trim().toUpperCase();
  }
  const authHeader = req.get('authorization');
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, '').trim().toUpperCase();
  }
  return '';
}

function sendAuthError(res, status, code, message, extra = {}) {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
    },
    ...extra,
  });
}

function isSafeHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

async function callKeyServerAuthorize(authConfig, payload) {
  if (typeof authConfig.customAuthorizer === 'function') {
    return authConfig.customAuthorizer(payload);
  }

  if (
    !authConfig.keyServerUrl ||
    !isSafeHttpUrl(authConfig.keyServerUrl) ||
    !authConfig.engineAuthSecret
  ) {
    const err = new Error('Engine license verification service is not configured.');
    err.code = 'AUTH_UNAVAILABLE';
    err.statusCode = 503;
    throw err;
  }

  const targetUrl = `${authConfig.keyServerUrl}/api/internal/authorize-engine`;
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Engine-Auth-Secret': authConfig.engineAuthSecret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(authConfig.keyVerifyTimeoutMs || 5000),
  });

  const data = await response.json().catch(() => null);
  if (response.status === 401 || response.status >= 500 || !data || typeof data !== 'object') {
    const err = new Error(data?.error || 'Unable to verify license key with authorization server.');
    err.code = 'AUTH_UNAVAILABLE';
    err.statusCode = 503;
    throw err;
  }

  return data;
}

function buildEngineAuthPayload(record, config) {
  const tier = record.tier || (record.isPremium ? 'premium' : 'temporary');
  const isPremium = Boolean(record.isPremium || tier === 'premium');
  const movesRemain =
    typeof record.movesRemain === 'number'
      ? record.movesRemain
      : typeof record.moves_remain === 'number'
        ? record.moves_remain
        : null;
  const maxAllowedDepth =
    typeof record.maxAllowedDepth === 'number'
      ? record.maxAllowedDepth
      : isPremium
        ? config.engine.maxDepth
        : 7;

  return {
    tier,
    isPremium,
    movesRemain,
    maxAllowedDepth,
    ...(record.unlimited ? { unlimited: true } : {}),
  };
}

function pruneMapIfNeeded(map, maxEntries, nowMs, isExpired) {
  if (map.size < maxEntries) return;
  for (const [k, v] of map.entries()) {
    if (isExpired(v, nowMs)) map.delete(k);
  }
  while (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

function createLicenseMiddleware(config) {
  const licenseCache = new Map();
  const fenDedupCache = new Map();
  const inFlightWarmups = new Map();

  function getCacheTtlMs() {
    const val = Number(config.auth?.cacheTtlMs);
    return Number.isFinite(val) && val >= 0 ? val : 300_000;
  }

  function cacheAuthorizedKey(key, authResult, nowMs) {
    const ttlMs = getCacheTtlMs();
    if (ttlMs <= 0) return null;

    pruneMapIfNeeded(licenseCache, MAX_LICENSE_CACHE_ENTRIES, nowMs, (entry, t) => entry.expiresAt <= t);
    const tier = authResult.tier || (authResult.isPremium ? 'premium' : 'temporary');
    const isPremium = Boolean(authResult.isPremium || tier === 'premium');
    const entry = {
      tier,
      isPremium,
      movesRemain:
        typeof authResult.moves_remain === 'number' ? authResult.moves_remain : null,
      maxAllowedDepth:
        typeof authResult.maxAllowedDepth === 'number'
          ? authResult.maxAllowedDepth
          : isPremium
            ? config.engine.maxDepth
            : 7,
      unlimited: Boolean(authResult.unlimited),
      revoked: false,
      staleAt: nowMs + Math.max(5_000, Math.floor(ttlMs / 2)),
      expiresAt: nowMs + ttlMs,
    };
    licenseCache.set(key, entry);
    return entry;
  }

  function markFenDedup(key, fen, feature, nowMs) {
    if (!fen) return;
    pruneMapIfNeeded(fenDedupCache, MAX_FEN_DEDUP_ENTRIES, nowMs, (exp, t) => exp <= t);
    fenDedupCache.set(`${key}|${fen}|${feature}`, nowMs + FEN_DEDUP_TTL_MS);
  }

  function isFenDeduplicated(key, fen, feature, nowMs) {
    if (!fen) return false;
    const dedupKey = `${key}|${fen}|${feature}`;
    const exp = fenDedupCache.get(dedupKey);
    return Boolean(exp && exp > nowMs);
  }

  function syncBackgroundAuthorize(key, payload) {
    Promise.resolve(callKeyServerAuthorize(config.auth, payload))
      .then((result) => {
        if (!result) return;
        const entry = licenseCache.get(key);
        if (!entry) return;
        if (!result.authorized) {
          if (result.code === 'INVALID_KEY') {
            entry.revoked = true;
          } else if (result.code === 'MOVES_EXHAUSTED') {
            entry.movesRemain = 0;
          }
          return;
        }
        const nowMs = Date.now();
        const ttlMs = getCacheTtlMs();
        entry.staleAt = nowMs + Math.max(5_000, Math.floor(ttlMs / 2));
        entry.expiresAt = nowMs + ttlMs;
        if (typeof result.moves_remain === 'number') {
          // Keep lower of local decremented count vs server count so active burst never overshoots
          entry.movesRemain =
            typeof entry.movesRemain === 'number'
              ? Math.min(entry.movesRemain, result.moves_remain)
              : result.moves_remain;
        }
      })
      .catch(() => {
        // Non-blocking background sync; transient errors will re-sync cleanly on next refresh
      });
  }

  function triggerBackgroundRefresh(key) {
    if (inFlightWarmups.has(key)) return;
    const job = Promise.resolve(
      callKeyServerAuthorize(config.auth, {
        key,
        charge: false,
      })
    )
      .then((result) => {
        if (!result) return;
        const nowMs = Date.now();
        if (!result.authorized) {
          const entry = licenseCache.get(key);
          if (entry) {
            if (result.code === 'INVALID_KEY') entry.revoked = true;
            if (result.code === 'MOVES_EXHAUSTED') entry.movesRemain = 0;
          }
          return;
        }
        cacheAuthorizedKey(key, result, nowMs);
      })
      .catch(() => {})
      .finally(() => {
        if (inFlightWarmups.get(key) === job) {
          inFlightWarmups.delete(key);
        }
      });
    inFlightWarmups.set(key, job);
  }

  function attachQuota(req, res, quotaObj) {
    req.engineAuth = quotaObj;
    if (typeof quotaObj.movesRemain === 'number') {
      res.setHeader('X-Moves-Remaining', String(quotaObj.movesRemain));
    }
  }

  function requireEngineLicense(feature = 'analyze') {
    return async (req, res, next) => {
      if (!config.auth?.requireLicenseKey) {
        return next();
      }

      const key = extractLicenseKey(req);
      if (!key) {
        return sendAuthError(
          res,
          401,
          'LICENSE_KEY_REQUIRED',
          'A valid Mujahi Chess license key is required for engine analysis.'
        );
      }

      if (!isValidKeyFormat(key)) {
        return sendAuthError(
          res,
          403,
          'INVALID_KEY',
          'License key must be an 8-character code starting with M.'
        );
      }

      // 0ms fast-path for built-in master UNLIMITED key (zero network round-trip)
      if (key === MASTER_UNLIMITED_KEY) {
        attachQuota(req, res, {
          tier: 'premium',
          isPremium: true,
          movesRemain: null,
          maxAllowedDepth: Math.max(24, config.engine.maxDepth),
          unlimited: true,
        });
        return next();
      }

      const fen =
        feature === 'soft-mistakes'
          ? req.validatedSoftMistakes?.fen || ''
          : req.validatedAnalysis?.fen || '';

      const requestedDepths = req.validatedAnalysis?.requestedDepths;
      const requestedMaxDepth =
        feature === 'analyze' && Array.isArray(requestedDepths) && requestedDepths.length > 0
          ? Math.max(...requestedDepths)
          : undefined;

      const nowMs = Date.now();
      const cacheTtlMs = getCacheTtlMs();
      const cached = cacheTtlMs > 0 ? licenseCache.get(key) : null;

      // 0ms fast-path when license state is cached in RAM
      if (cached && cached.expiresAt > nowMs) {
        if (cached.revoked) {
          return sendAuthError(
            res,
            403,
            'INVALID_KEY',
            'This license key has been revoked or invalidated.'
          );
        }

        if (
          feature === 'analyze' &&
          requestedMaxDepth !== undefined &&
          requestedMaxDepth > cached.maxAllowedDepth
        ) {
          return sendAuthError(
            res,
            403,
            'DEPTH_LOCKED',
            `Temporary keys are limited to depth ${cached.maxAllowedDepth}. Use depth <= ${cached.maxAllowedDepth} or activate a Premium key.`,
            { maxAllowedDepth: cached.maxAllowedDepth }
          );
        }

        if (cached.tier === 'temporary') {
          if ((cached.movesRemain ?? 0) <= 0) {
            return sendAuthError(
              res,
              403,
              'MOVES_EXHAUSTED',
              'This temporary key has 0 moves remaining.',
              { maxAllowedDepth: cached.maxAllowedDepth }
            );
          }

          if (!isFenDeduplicated(key, fen, feature, nowMs)) {
            cached.movesRemain = Math.max(0, (cached.movesRemain ?? 0) - 1);
            markFenDedup(key, fen, feature, nowMs);
            // Persist deduction asynchronously so Stockfish starts with 0ms delay
            syncBackgroundAuthorize(key, {
              key,
              fen,
              requestedMaxDepth,
              feature,
            });
          } else if (nowMs > cached.staleAt) {
            triggerBackgroundRefresh(key);
          }
        } else if (nowMs > cached.staleAt) {
          // Stale-while-revalidate in background for Premium keys (0ms blocking delay)
          triggerBackgroundRefresh(key);
        }

        attachQuota(req, res, buildEngineAuthPayload(cached, config));
        return next();
      }

      // Cache miss: validate against key server once and cache for subsequent moves
      try {
        const authResult = await callKeyServerAuthorize(config.auth, {
          key,
          fen,
          requestedMaxDepth,
          feature,
        });

        if (!authResult.authorized) {
          const denyStatus = Number.isInteger(authResult.status) ? authResult.status : 403;
          if (authResult.code === 'MOVES_EXHAUSTED' && cacheTtlMs > 0) {
            licenseCache.set(key, {
              tier: 'temporary',
              isPremium: false,
              movesRemain: 0,
              maxAllowedDepth: authResult.maxAllowedDepth || 7,
              unlimited: false,
              revoked: false,
              staleAt: nowMs + 15_000,
              expiresAt: nowMs + 30_000,
            });
          }
          return sendAuthError(
            res,
            denyStatus,
            authResult.code || 'INVALID_KEY',
            authResult.error || 'License authorization denied.',
            typeof authResult.maxAllowedDepth === 'number'
              ? { maxAllowedDepth: authResult.maxAllowedDepth }
              : {}
          );
        }

        cacheAuthorizedKey(key, authResult, nowMs);
        markFenDedup(key, fen, feature, nowMs);
        attachQuota(req, res, buildEngineAuthPayload(authResult, config));
        return next();
      } catch (err) {
        return sendAuthError(
          res,
          503,
          'AUTH_UNAVAILABLE',
          err?.message || 'License server verification unavailable.'
        );
      }
    };
  }

  async function warmEngineLicense(req, res) {
    if (!config.auth?.requireLicenseKey) {
      return res.json({ success: true, warmed: true, required: false });
    }

    const key = extractLicenseKey(req);
    if (!key) {
      return sendAuthError(
        res,
        401,
        'LICENSE_KEY_REQUIRED',
        'A valid Mujahi Chess license key is required.'
      );
    }
    if (!isValidKeyFormat(key)) {
      return sendAuthError(
        res,
        403,
        'INVALID_KEY',
        'License key must be an 8-character code starting with M.'
      );
    }

    if (key === MASTER_UNLIMITED_KEY) {
      const quota = {
        tier: 'premium',
        isPremium: true,
        movesRemain: null,
        maxAllowedDepth: Math.max(24, config.engine.maxDepth),
        unlimited: true,
      };
      return res.json({ success: true, warmed: true, cached: true, quota });
    }

    const force = Boolean(req.body?.force || req.query?.force === '1');
    const nowMs = Date.now();
    const existing = licenseCache.get(key);
    if (!force && existing && !existing.revoked && existing.expiresAt > nowMs) {
      return res.json({
        success: true,
        warmed: true,
        cached: true,
        quota: buildEngineAuthPayload(existing, config),
      });
    }

    let checkPromise = inFlightWarmups.get(key);
    if (!checkPromise || force) {
      checkPromise = Promise.resolve(
        callKeyServerAuthorize(config.auth, {
          key,
          charge: false,
        })
      ).finally(() => {
        if (inFlightWarmups.get(key) === checkPromise) {
          inFlightWarmups.delete(key);
        }
      });
      inFlightWarmups.set(key, checkPromise);
    }

    try {
      const authResult = await checkPromise;
      if (!authResult.authorized) {
        licenseCache.delete(key);
        const denyStatus = Number.isInteger(authResult.status) ? authResult.status : 403;
        return sendAuthError(
          res,
          denyStatus,
          authResult.code || 'INVALID_KEY',
          authResult.error || 'License authorization denied.'
        );
      }

      cacheAuthorizedKey(key, authResult, Date.now());
      const quota = buildEngineAuthPayload(authResult, config);
      if (typeof quota.movesRemain === 'number') {
        res.setHeader('X-Moves-Remaining', String(quota.movesRemain));
      }
      return res.json({ success: true, warmed: true, cached: false, quota });
    } catch (err) {
      return sendAuthError(
        res,
        503,
        'AUTH_UNAVAILABLE',
        err?.message || 'License server verification unavailable.'
      );
    }
  }

  return {
    requireEngineLicense,
    warmEngineLicense,
  };
}

function requireEngineLicense(config, feature = 'analyze') {
  return createLicenseMiddleware(config).requireEngineLicense(feature);
}

module.exports = {
  createLicenseMiddleware,
  requireEngineLicense,
  extractLicenseKey,
};
