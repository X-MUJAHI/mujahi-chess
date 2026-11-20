'use strict';

const PINNED_STOCKFISH = Object.freeze({
  brandName: 'MUJAHI Stockfish',
  tag: 'sf_19',
  version: '19',
  commit: 'edb0d9db6731067ec50ce619ff372b463bc4dd5d',
  nnueArchitecture: 'SFNNv16',
  defaultNet: 'nn-1a298aa575a0.nnue',
  repository: 'https://github.com/official-stockfish/Stockfish',
});

function parseIntEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseCorsOrigins(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadConfig() {
  const maxDepth = parseIntEnv('ENGINE_MAX_DEPTH', 20, 1, 24);
  const defaultDepth = Math.min(maxDepth, parseIntEnv('ENGINE_DEFAULT_DEPTH', 15, 1, maxDepth));
  const maxTimeoutMs = parseIntEnv('ENGINE_MAX_TIMEOUT_MS', 180000, 1000, 600000);
  const rawTimeout = process.env.ENGINE_TIMEOUT_MS;
  let defaultTimeoutMs = 45000;
  if (rawTimeout !== undefined && rawTimeout !== '') {
    const parsed = Number.parseInt(rawTimeout, 10);
    if (Number.isFinite(parsed)) {
      defaultTimeoutMs = parsed <= 0 ? 0 : Math.max(1000, Math.min(maxTimeoutMs, parsed));
    }
  }

  return Object.freeze({
    nodeEnv: process.env.NODE_ENV || 'development',
    apiVersion: 'v1',
    port: parseIntEnv('PORT', 3000, 1, 65535),
    host: process.env.HOST || '0.0.0.0',
    trustProxy: parseIntEnv('TRUST_PROXY', 1, 0, 10),
    stockfishPath: process.env.STOCKFISH_PATH || 'stockfish',
    engine: Object.freeze({
      threads: parseIntEnv('ENGINE_THREADS', 1, 1, 4),
      hashMb: parseIntEnv('ENGINE_HASH_MB', 64, 16, 1024),
      defaultDepth,
      maxDepth,
      multiPv: 1, // Fixed to 1 for MVP resource safety
      timeoutMs: defaultTimeoutMs,
      maxTimeoutMs,
      stopTimeoutMs: parseIntEnv('ENGINE_STOP_TIMEOUT_MS', 3000, 500, 15000),
      initTimeoutMs: parseIntEnv('ENGINE_INIT_TIMEOUT_MS', 15000, 2000, 60000),
      maxQueue: parseIntEnv('ENGINE_MAX_QUEUE', 10, 1, 100),
    }),
    cache: Object.freeze({
      ttlMs: parseIntEnv('DEDUP_CACHE_TTL_MS', 30000, 0, 300000),
      maxEntries: parseIntEnv('DEDUP_CACHE_MAX_ENTRIES', 200, 0, 2000),
    }),
    corsAllowedOrigins: parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS),
    rateLimit: Object.freeze({
      windowMs: parseIntEnv('RATE_LIMIT_WINDOW_MS', 60000, 1000, 3600000),
      max: parseIntEnv('RATE_LIMIT_MAX', 45, 1, 1000),
    }),
    pinnedStockfish: PINNED_STOCKFISH,
  });
}

module.exports = {
  loadConfig,
  PINNED_STOCKFISH,
};
