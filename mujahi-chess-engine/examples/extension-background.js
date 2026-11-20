/**
 * MUJAHI Chess Engine — Manifest V3 Background Service Worker
 *
 * Register in Chess Helper 2.1.0 manifest.json:
 *   "background": { "service_worker": "engine/mujahi-background.js" },
 *   "host_permissions": [ "https://mujahi-chess.onrender.com/*", ...existing hosts ]
 *
 * Performing requests here avoids exposing Chess.com in backend CORS allowlists
 * and keeps progressive SSE streaming independent of page CSP restrictions.
 */
'use strict';

const DEFAULT_MUJAHI_API_URL = 'https://mujahi-chess.onrender.com';

let workerSessionId = null;
function getSessionId() {
  if (!workerSessionId) {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    workerSessionId = `ext_${id}`;
  }
  return workerSessionId;
}

function normalizeBaseUrl(baseUrl) {
  const clean = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : DEFAULT_MUJAHI_API_URL;
  return clean.replace(/\/+$/, '');
}

async function analyzeJson({ baseUrl, fen, depths, timeoutMs, clientSessionId, signal }) {
  const url = `${normalizeBaseUrl(baseUrl)}/v1/analyze`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client-Session-Id': clientSessionId || getSessionId(),
    },
    body: JSON.stringify({
      fen,
      depths,
      clientSessionId: clientSessionId || getSessionId(),
      ...(timeoutMs ? { timeoutMs } : {}),
    }),
    signal,
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error?.message || `HTTP ${res.status} from MUJAHI API`);
  }
  return payload;
}

async function analyzeStream({ baseUrl, fen, depths, timeoutMs, clientSessionId, signal, onEvent }) {
  const url = `${normalizeBaseUrl(baseUrl)}/v1/analyze/stream`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Client-Session-Id': clientSessionId || getSessionId(),
    },
    body: JSON.stringify({
      fen,
      depths,
      clientSessionId: clientSessionId || getSessionId(),
      ...(timeoutMs ? { timeoutMs } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const errPayload = await res.json().catch(() => null);
    throw new Error(errPayload?.error?.message || `HTTP ${res.status} from MUJAHI stream`);
  }

  if (!res.body) {
    throw new Error('ReadableStream unavailable in service worker.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitIdx;
    while ((splitIdx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, splitIdx);
      buffer = buffer.slice(splitIdx + 2);

      let event = 'message';
      const dataLines = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;

      try {
        const data = JSON.parse(dataLines.join('\n'));
        onEvent(event, data);
      } catch {
        // Ignore malformed SSE comment/keepalive chunk
      }
    }
  }
}

// Long-lived port connection for progressive SSE depth snapshots (D5 -> D10 -> D15)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'mujahi-analysis-stream') return;

  let activeController = null;
  let disconnected = false;

  const safePost = (msg) => {
    if (!disconnected) {
      try {
        port.postMessage(msg);
      } catch {
        disconnected = true;
      }
    }
  };

  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
  });

  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'cancel') {
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
      return;
    }

    if (msg.type === 'analyze_stream') {
      if (activeController) activeController.abort();
      activeController = new AbortController();
      const { signal } = activeController;

      try {
        await analyzeStream({
          baseUrl: msg.baseUrl,
          fen: msg.fen,
          depths: msg.depths,
          timeoutMs: msg.timeoutMs,
          clientSessionId: msg.clientSessionId,
          signal,
          onEvent: (event, data) => {
            safePost({ type: 'sse_event', requestId: msg.requestId, event, data });
          },
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          safePost({
            type: 'sse_error',
            requestId: msg.requestId,
            message: err.message || 'MUJAHI stream failed',
          });
        }
      } finally {
        activeController = null;
      }
    }
  });
});

// One-shot JSON fallback & health probe
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'MUJAHI_HEALTH') {
    const baseUrl = normalizeBaseUrl(msg.baseUrl);
    fetch(`${baseUrl}/health`, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        sendResponse({ ok: res.ok, status: res.status, payload });
      })
      .catch((err) => {
        sendResponse({ ok: false, status: 0, error: err.message });
      });
    return true;
  }

  if (msg.type === 'MUJAHI_ANALYZE_JSON') {
    const controller = new AbortController();
    analyzeJson({
      baseUrl: msg.baseUrl,
      fen: msg.fen,
      depths: msg.depths,
      timeoutMs: msg.timeoutMs,
      clientSessionId: msg.clientSessionId,
      signal: controller.signal,
    })
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
