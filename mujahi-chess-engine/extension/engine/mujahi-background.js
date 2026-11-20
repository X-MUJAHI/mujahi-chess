/**
 * MUJAHI Chess Engine — Manifest V3 Background Service Worker
 *
 * Keeps MUJAHI backend requests inside the extension service worker (using MV3
 * host_permissions for https://mujahi-chess.onrender.com/*) so Chess.com pages
 * never need third-party CORS exemptions and SSE progressive streaming runs cleanly.
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
  const sessionId = clientSessionId || getSessionId();
  const url = `${normalizeBaseUrl(baseUrl)}/v1/analyze`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client-Session-Id': sessionId,
    },
    body: JSON.stringify({
      fen,
      depths,
      clientSessionId: sessionId,
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
  const sessionId = clientSessionId || getSessionId();
  const url = `${normalizeBaseUrl(baseUrl)}/v1/analyze/stream`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Client-Session-Id': sessionId,
    },
    body: JSON.stringify({
      fen,
      depths,
      clientSessionId: sessionId,
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
  let sawTerminalEvent = false;

  const flushBlock = (block) => {
    let event = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;

    try {
      const data = JSON.parse(dataLines.join('\n'));
      if (event === 'complete' || event === 'error') {
        sawTerminalEvent = true;
      }
      onEvent(event, data);
    } catch {
      // Ignore malformed SSE comment/keepalive chunk
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let splitIdx;
    while ((splitIdx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, splitIdx);
      buffer = buffer.slice(splitIdx + 2);
      if (block.trim()) flushBlock(block);
    }
  }

  buffer += decoder.decode().replace(/\r\n/g, '\n');
  if (buffer.trim()) {
    flushBlock(buffer);
  }

  if (!sawTerminalEvent && !signal?.aborted) {
    throw new Error('MUJAHI SSE stream closed unexpectedly.');
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
      const controller = new AbortController();
      activeController = controller;

      try {
        await analyzeStream({
          baseUrl: msg.baseUrl,
          fen: msg.fen,
          depths: msg.depths,
          timeoutMs: msg.timeoutMs,
          clientSessionId: msg.clientSessionId,
          signal: controller.signal,
          onEvent: (event, data) => {
            safePost({ type: 'sse_event', requestId: msg.requestId, event, data });
          },
        });
      } catch (err) {
        if (err?.name !== 'AbortError' && !disconnected) {
          safePost({
            type: 'sse_error',
            requestId: msg.requestId,
            message: err?.message || 'MUJAHI stream failed',
          });
        }
      } finally {
        if (activeController === controller) {
          activeController = null;
        }
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
        sendResponse({ ok: false, status: 0, error: err?.message || 'Health request failed' });
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
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'MUJAHI JSON request failed' }));
    return true;
  }

  return false;
});
