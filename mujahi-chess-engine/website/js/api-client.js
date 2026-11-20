/**
 * Vanilla JS client for MUJAHI Chess Engine API (REST + SSE).
 * Reads API_BASE_URL from window.MUJAHI_CONFIG with optional localStorage override.
 */
(function attachMujahiClient(global) {
  'use strict';

  const STORAGE_OVERRIDE_KEY = 'mujahi_api_base_override';
  const SESSION_STORAGE_KEY = 'mujahi_client_session_id';

  function getClientSessionId() {
    try {
      let existing = global.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!existing) {
        const rand =
          global.crypto && typeof global.crypto.randomUUID === 'function'
            ? global.crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        existing = `web_${rand}`;
        global.sessionStorage.setItem(SESSION_STORAGE_KEY, existing);
      }
      return existing;
    } catch {
      return `web_${Date.now().toString(36)}`;
    }
  }

  function sanitizeBaseUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/\/+$/, '');
  }

  function getApiBaseUrl() {
    try {
      const override = sanitizeBaseUrl(global.localStorage.getItem(STORAGE_OVERRIDE_KEY));
      if (override) return override;
    } catch {
      // Ignore storage access errors in locked-down browsers.
    }
    return sanitizeBaseUrl(global.MUJAHI_CONFIG?.API_BASE_URL || '');
  }

  function setApiBaseUrlOverride(url) {
    const clean = sanitizeBaseUrl(url);
    try {
      if (clean) {
        global.localStorage.setItem(STORAGE_OVERRIDE_KEY, clean);
      } else {
        global.localStorage.removeItem(STORAGE_OVERRIDE_KEY);
      }
    } catch {
      // Ignore storage write errors.
    }
    return getApiBaseUrl();
  }

  class MujahiApiError extends Error {
    constructor(message, { status = 0, code = 'API_ERROR', details = null } = {}) {
      super(message);
      this.name = 'MujahiApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  async function requestJson(path, { method = 'GET', body = null, signal = null } = {}) {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new MujahiApiError('API base URL is not configured.', { code: 'CONFIG_ERROR' });
    }

    const headers = {
      Accept: 'application/json',
      'X-Client-Session-Id': getClientSessionId(),
    };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
    }

    const startedAt = global.performance ? global.performance.now() : Date.now();
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
      signal,
    });
    const latencyMs = Math.round((global.performance ? global.performance.now() : Date.now()) - startedAt);

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = payload?.error?.message || `HTTP ${res.status} from ${path}`;
      const code = payload?.error?.code || `HTTP_${res.status}`;
      throw new MujahiApiError(msg, { status: res.status, code, details: payload?.error || null });
    }

    return { payload, latencyMs, status: res.status };
  }

  async function getHealth({ signal = null } = {}) {
    return requestJson('/health', { method: 'GET', signal });
  }

  async function getEngineInfo({ signal = null } = {}) {
    return requestJson('/v1/engine', { method: 'GET', signal });
  }

  async function analyzePosition(
    { fen, depths = [5, 10, 15], timeoutMs = undefined, clientSessionId = getClientSessionId() },
    { signal = null } = {}
  ) {
    const body = { fen, depths, clientSessionId };
    if (timeoutMs !== undefined && timeoutMs !== null && timeoutMs !== '') {
      body.timeoutMs = Number(timeoutMs);
    }
    return requestJson('/v1/analyze', { method: 'POST', body, signal });
  }

  /**
   * Streams progressive depth snapshots from POST /v1/analyze/stream via Fetch ReadableStream.
   */
  async function streamAnalyzePosition(
    {
      fen,
      depths = [5, 10, 15],
      timeoutMs = undefined,
      clientSessionId = getClientSessionId(),
      onStarted = null,
      onSnapshot = null,
    },
    { signal = null } = {}
  ) {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new MujahiApiError('API base URL is not configured.', { code: 'CONFIG_ERROR' });
    }

    const body = { fen, depths, clientSessionId };
    if (timeoutMs !== undefined && timeoutMs !== null && timeoutMs !== '') {
      body.timeoutMs = Number(timeoutMs);
    }

    const startedAt = global.performance ? global.performance.now() : Date.now();
    const res = await fetch(`${baseUrl}/v1/analyze/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Client-Session-Id': clientSessionId,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new MujahiApiError(
        errJson?.error?.message || `HTTP ${res.status} from /v1/analyze/stream`,
        {
          status: res.status,
          code: errJson?.error?.code || `HTTP_${res.status}`,
          details: errJson?.error || null,
        }
      );
    }

    if (!res.body) {
      throw new MujahiApiError('Streaming body is unavailable in this browser.', {
        code: 'STREAM_UNSUPPORTED',
      });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completedPayload = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const rawBlock = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let eventType = 'message';
        const dataLines = [];
        for (const line of rawBlock.split('\n')) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (dataLines.length === 0) continue;

        let parsed;
        try {
          parsed = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }

        if (eventType === 'started' && typeof onStarted === 'function') {
          onStarted(parsed);
        } else if (eventType === 'snapshot' && typeof onSnapshot === 'function') {
          onSnapshot(parsed);
        } else if (eventType === 'complete') {
          completedPayload = parsed;
        } else if (eventType === 'error') {
          throw new MujahiApiError(parsed?.error?.message || 'Streaming error', {
            status: 500,
            code: parsed?.error?.code || 'STREAM_ERROR',
          });
        }
      }
    }

    if (!completedPayload) {
      throw new MujahiApiError('Stream ended before complete event was received.', {
        code: 'INCOMPLETE_STREAM',
      });
    }

    const latencyMs = Math.round((global.performance ? global.performance.now() : Date.now()) - startedAt);
    return { payload: completedPayload, latencyMs, status: 200 };
  }

  global.MujahiApiClient = {
    MujahiApiError,
    getApiBaseUrl,
    setApiBaseUrlOverride,
    getClientSessionId,
    getHealth,
    getEngineInfo,
    analyzePosition,
    streamAnalyzePosition,
  };
})(window);
