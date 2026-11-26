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

function buildApiError(status, payload, fallbackLabel) {
  const code = payload?.error?.code || '';
  const baseMessage = payload?.error?.message || `HTTP ${status} from ${fallbackLabel}`;
  const err = new Error(code ? `[${code}] ${baseMessage}` : baseMessage);
  err.status = status;
  err.code = code || (status ? `HTTP_${status}` : 'NETWORK_ERROR');
  return err;
}

async function analyzeJson({ baseUrl, fen, depths, timeoutMs, clientSessionId, licenseKey, signal }) {
  const sessionId = clientSessionId || getSessionId();
  const url = `${normalizeBaseUrl(baseUrl)}/v1/analyze`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Client-Session-Id': sessionId,
  };
  if (typeof licenseKey === 'string' && licenseKey.trim()) {
    headers['X-License-Key'] = licenseKey.trim().toUpperCase();
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
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
    throw buildApiError(res.status, payload, 'MUJAHI API');
  }
  return payload;
}

async function analyzeSoftMistakes({ baseUrl, fen, minDropCp, maxDropCp, maxResults, timeoutMs, licenseKey, signal }) {
  const url = `${normalizeBaseUrl(baseUrl)}/v1/analyze/soft-mistakes`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (typeof licenseKey === 'string' && licenseKey.trim()) {
    headers['X-License-Key'] = licenseKey.trim().toUpperCase();
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fen,
      minDropCp,
      maxDropCp,
      maxResults,
      ...(timeoutMs ? { timeoutMs } : {}),
    }),
    signal,
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw buildApiError(res.status, payload, 'MUJAHI Soft Mistakes');
  }
  return payload;
}

async function analyzeStream({ baseUrl, fen, depths, timeoutMs, clientSessionId, licenseKey, signal, onEvent }) {
  const sessionId = clientSessionId || getSessionId();
  const url = `${normalizeBaseUrl(baseUrl)}/v1/analyze/stream`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'X-Client-Session-Id': sessionId,
  };
  if (typeof licenseKey === 'string' && licenseKey.trim()) {
    headers['X-License-Key'] = licenseKey.trim().toUpperCase();
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
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
    throw buildApiError(res.status, errPayload, 'MUJAHI stream');
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

// --- LOCAL STOCKFISH OFFSCREEN HOST RELAY ---
const LOCAL_STOCKFISH_CHANNEL = 'chess-helper-local-stockfish-v1';
let offscreenHostPort = null;
let offscreenHostReady = false;
let offscreenHostError = '';
let offscreenLifecycleLock = Promise.resolve();
let offscreenClosingIntentionally = false;
let activeStockfishClientPort = null;
let pendingStockfishHostMessages = [];

async function hasExistingOffscreenHost() {
  if (typeof chrome === 'undefined') return false;
  if (chrome.runtime?.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('engine/host.html')],
      });
      if (Array.isArray(contexts) && contexts.length > 0) return true;
    } catch (_) {}
  }
  if (chrome.offscreen?.hasDocument) {
    try {
      return Boolean(await chrome.offscreen.hasDocument());
    } catch (_) {}
  }
  return false;
}

function withOffscreenLock(task) {
  const next = offscreenLifecycleLock.then(task, task);
  offscreenLifecycleLock = next.catch(() => {});
  return next;
}

function ensureLocalStockfishOffscreen() {
  return withOffscreenLock(async () => {
    if (typeof chrome === 'undefined' || !chrome.offscreen?.createDocument) {
      const err = new Error('chrome.offscreen is unavailable in this browser.');
      err.fallbackIframe = true;
      throw err;
    }
    if (offscreenHostPort) return true;

    let exists = await hasExistingOffscreenHost();
    if (exists && !offscreenHostPort) {
      // Allow a brief grace window in case host.js is mid-startup; otherwise close & recreate stale document.
      await new Promise((r) => setTimeout(r, 250));
      if (offscreenHostPort) return true;
      if (chrome.offscreen?.closeDocument) {
        offscreenClosingIntentionally = true;
        try { await chrome.offscreen.closeDocument(); } catch (_) {}
        offscreenClosingIntentionally = false;
      }
      exists = await hasExistingOffscreenHost();
    }

    if (!exists) {
      offscreenHostReady = false;
      offscreenHostError = '';
      const reason = chrome.offscreen?.Reason?.WORKERS || 'WORKERS';
      try {
        await chrome.offscreen.createDocument({
          url: 'engine/host.html',
          reasons: [reason],
          justification: 'Run local Stockfish 19 WebAssembly engine worker cleanly outside third-party page iframes.',
        });
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err || 'Failed to create offscreen host'));
        wrapped.fallbackIframe = true;
        throw wrapped;
      }
    }
    return true;
  });
}

function closeLocalStockfishOffscreenIfUnused(closingPort) {
  return withOffscreenLock(async () => {
    if (activeStockfishClientPort && activeStockfishClientPort !== closingPort) return;
    if (chrome.offscreen?.closeDocument) {
      const exists = await hasExistingOffscreenHost();
      if (exists) {
        try { await chrome.offscreen.closeDocument(); } catch (_) {}
      }
    }
  });
}

function sendToStockfishClient(payload) {
  if (!activeStockfishClientPort) return;
  try {
    activeStockfishClientPort.postMessage(payload);
  } catch (_) {
    activeStockfishClientPort = null;
  }
}

function sendToStockfishHost(payload) {
  if (offscreenHostPort) {
    try {
      offscreenHostPort.postMessage(payload);
      return;
    } catch (_) {
      offscreenHostPort = null;
    }
  }
  pendingStockfishHostMessages.push(payload);
}

// Long-lived port connection for progressive SSE depth snapshots (D5 -> D10 -> D15)
// plus local Stockfish offscreen host <-> content-script relay.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'local-stockfish-host') {
    offscreenHostPort = port;
    offscreenClosingIntentionally = false;

    const queued = pendingStockfishHostMessages.splice(0, pendingStockfishHostMessages.length);
    for (const item of queued) {
      try { port.postMessage(item); } catch (_) {}
    }

    port.onMessage.addListener((msg) => {
      if (!msg || msg.channel !== LOCAL_STOCKFISH_CHANNEL) return;
      if (msg.type === 'ready') {
        offscreenHostReady = true;
        offscreenHostError = '';
      } else if (msg.type === 'error') {
        offscreenHostReady = false;
        offscreenHostError = msg.message || 'Local Stockfish worker error.';
      } else if (msg.type === 'terminated') {
        offscreenHostReady = false;
      }
      sendToStockfishClient(msg);
    });

    port.onDisconnect.addListener(() => {
      if (offscreenHostPort === port) offscreenHostPort = null;
      const wasReady = offscreenHostReady;
      offscreenHostReady = false;
      pendingStockfishHostMessages = [];
      if (!offscreenClosingIntentionally && wasReady && activeStockfishClientPort) {
        sendToStockfishClient({
          channel: LOCAL_STOCKFISH_CHANNEL,
          type: 'error',
          message: 'Background Stockfish worker closed unexpectedly. Click Find or retry to restart.',
        });
      }
      offscreenClosingIntentionally = false;
    });
    return;
  }

  if (port.name === 'local-stockfish-client') {
    activeStockfishClientPort = port;
    let clientDisconnected = false;

    port.onDisconnect.addListener(() => {
      clientDisconnected = true;
      if (activeStockfishClientPort === port) activeStockfishClientPort = null;
    });

    port.onMessage.addListener(async (msg) => {
      if (!msg || msg.channel !== LOCAL_STOCKFISH_CHANNEL) return;
      if (msg.type === 'terminate') {
        pendingStockfishHostMessages = [];
        if (offscreenHostPort) {
          offscreenClosingIntentionally = true;
          try { offscreenHostPort.postMessage(msg); } catch (_) {}
        }
        offscreenHostReady = false;
        offscreenHostError = '';
        await closeLocalStockfishOffscreenIfUnused(port);
        return;
      }

      if (msg.type === 'restart') {
        offscreenHostReady = false;
        offscreenHostError = '';
        try {
          await ensureLocalStockfishOffscreen();
          if (clientDisconnected) return;
          sendToStockfishHost({ channel: LOCAL_STOCKFISH_CHANNEL, type: 'restart' });
        } catch (err) {
          if (!clientDisconnected) {
            try {
              port.postMessage({
                channel: LOCAL_STOCKFISH_CHANNEL,
                type: 'error',
                fallbackIframe: Boolean(err?.fallbackIframe),
                message: err?.message || 'Unable to start offscreen Stockfish host.',
              });
            } catch (_) {}
          }
        }
        return;
      }

      sendToStockfishHost(msg);
    });

    ensureLocalStockfishOffscreen()
      .then(() => {
        if (clientDisconnected || activeStockfishClientPort !== port) return;
        if (offscreenHostPort && offscreenHostReady) {
          port.postMessage({ channel: LOCAL_STOCKFISH_CHANNEL, type: 'ready' });
        } else if (offscreenHostPort && offscreenHostError) {
          // Automatically retry a fresh worker start when a client explicitly reconnects after an earlier failure.
          offscreenHostError = '';
          sendToStockfishHost({ channel: LOCAL_STOCKFISH_CHANNEL, type: 'restart' });
        }
      })
      .catch((err) => {
        if (clientDisconnected) return;
        try {
          port.postMessage({
            channel: LOCAL_STOCKFISH_CHANNEL,
            type: 'error',
            fallbackIframe: Boolean(err?.fallbackIframe),
            message: err?.message || 'Unable to initialize offscreen Stockfish host.',
          });
        } catch (_) {}
      });
    return;
  }

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
          licenseKey: msg.licenseKey,
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
            status: err?.status || 0,
            code: err?.code || '',
            extensionId: chrome.runtime?.id || '',
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

const ALLOWED_AUX_HOSTS = new Set([
  'lichess.org',
  'explorer.lichess.org',
  'tablebase.lichess.ovh',
]);

// One-shot JSON fallback, health probe & Lichess background fetch
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'FETCH_JSON') {
    let parsedUrl;
    try {
      parsedUrl = new URL(String(msg.url || ''));
    } catch {
      sendResponse({ ok: false, status: 400, error: 'Invalid URL' });
      return false;
    }
    if (parsedUrl.protocol !== 'https:' || !ALLOWED_AUX_HOSTS.has(parsedUrl.hostname)) {
      sendResponse({ ok: false, status: 403, error: 'Host not permitted' });
      return false;
    }
    fetch(parsedUrl.toString(), { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        const retryAfter = res.headers.get('Retry-After') || '';
        const data = await res.json().catch(() => null);
        sendResponse({
          ok: res.ok,
          status: res.status,
          retryAfter,
          data,
        });
      })
      .catch((err) => {
        sendResponse({
          ok: false,
          status: 0,
          error: err?.message || 'Background network request failed',
        });
      });
    return true;
  }

  if (msg.type === 'MUJAHI_HEALTH') {
    const baseUrl = normalizeBaseUrl(msg.baseUrl);
    fetch(`${baseUrl}/health`, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        sendResponse({
          ok: res.ok,
          status: res.status,
          payload,
          extensionId: chrome.runtime?.id || '',
        });
      })
      .catch((err) => {
        sendResponse({
          ok: false,
          status: 0,
          error: err?.message || 'Health request failed',
          extensionId: chrome.runtime?.id || '',
        });
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
      licenseKey: msg.licenseKey,
      signal: controller.signal,
    })
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err?.message || 'MUJAHI JSON request failed',
          status: err?.status || 0,
          code: err?.code || '',
          extensionId: chrome.runtime?.id || '',
        })
      );
    return true;
  }

  if (msg.type === 'MUJAHI_SOFT_MISTAKES') {
    const controller = new AbortController();
    analyzeSoftMistakes({
      baseUrl: msg.baseUrl,
      fen: msg.fen,
      minDropCp: msg.minDropCp,
      maxDropCp: msg.maxDropCp,
      maxResults: msg.maxResults,
      timeoutMs: msg.timeoutMs,
      licenseKey: msg.licenseKey,
      signal: controller.signal,
    })
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err?.message || 'MUJAHI soft mistakes request failed',
          status: err?.status || 0,
          code: err?.code || '',
          extensionId: chrome.runtime?.id || '',
        })
      );
    return true;
  }

  if (msg.type === 'MUJAHI_WARM_KEY') {
    const baseUrl = normalizeBaseUrl(msg.baseUrl);
    const licenseKey = typeof msg.licenseKey === 'string' ? msg.licenseKey.trim().toUpperCase() : '';
    if (!licenseKey || licenseKey === 'UNLIMITED') {
      sendResponse({ ok: true, skipped: true });
      return false;
    }
    fetch(`${baseUrl}/v1/auth/warm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-License-Key': licenseKey,
      },
      body: JSON.stringify({ force: Boolean(msg.force) }),
    })
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        sendResponse({
          ok: res.ok,
          status: res.status,
          payload,
        });
      })
      .catch((err) => {
        sendResponse({
          ok: false,
          status: 0,
          error: err?.message || 'License warm-up failed',
        });
      });
    return true;
  }

  return false;
});
