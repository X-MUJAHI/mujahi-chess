// --- CONSTANTS ---
const pieceToFen = { 'wp': 'P', 'wn': 'N', 'wb': 'B', 'wr': 'R', 'wq': 'Q', 'wk': 'K', 'bp': 'p', 'bn': 'n', 'bb': 'b', 'br': 'r', 'bq': 'q', 'bk': 'k' };
const colToNum = { 'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5, 'f': 6, 'g': 7, 'h': 8 };
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomIntInclusive(min, max) {
    if (max <= min) return min;
    const range = max - min + 1;
    const cryptoApi = window.crypto;
    if (cryptoApi?.getRandomValues) {
        const limit = Math.floor(0x100000000 / range) * range;
        const sample = new Uint32Array(1);
        let value;
        do { cryptoApi.getRandomValues(sample); value = sample[0]; } while (value >= limit);
        return min + (value % range);
    }
    return min + Math.floor(Math.random() * range);
}
let pendingAutoPlayDelayCancel = null;
function waitForAutoPlayDelay(ms, signal) {
    if (ms <= 0) return Promise.resolve(!signal?.aborted);
    return new Promise(resolve => {
        let timer = null;
        let settled = false;
        const finish = completed => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (pendingAutoPlayDelayCancel === cancel) pendingAutoPlayDelayCancel = null;
            resolve(completed);
        };
        const onAbort = () => finish(false);
        const cancel = () => finish(false);
        if (signal?.aborted) { finish(false); return; }
        pendingAutoPlayDelayCancel = cancel;
        timer = setTimeout(() => finish(true), ms);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
    });
}
function log(msg) { console.log(`[ChessEngine] ${msg}`); }

let countdownInterval = null;
let hasShownExhaustModal = false;

const fenCache = new Map();
const lichessFenCache = new Map();
const engineInFlight = new Map();
const databaseInFlight = new Map();
const engineAnalysisCache = new Map();
const superModeAuxCache = new Map();
const superModeSnapshotsByFen = new Map();
const softMistakesCache = new Map();
let softMistakesController = null;
let softMistakesCurrentFen = '';
let softMistakesSelectedMove = '';
let softMistakesLastState = { fen: '', status: 'Click Find when you want mild mistakes', candidates: [], sourceLabel: '' };
function setBoundedCache(cache, key, value, limit = 300) { cache.delete(key); cache.set(key, value); if (cache.size > limit) cache.delete(cache.keys().next().value); }

// --- LOCAL STOCKFISH 19 WASM BRIDGE ---
// The content script runs on chess.com, so it cannot create a Worker from a
// chrome-extension:// URL directly. A small web-accessible extension iframe
// hosts the Worker on the extension origin and relays UCI messages securely.
const LOCAL_ENGINE_CHANNEL = 'chess-helper-local-stockfish-v1';
const LOCAL_ENGINE_HOST_PATH = 'engine/host.html';
const LOCAL_ENGINE_WORKER_PATH = 'engine/stockfish-19-lite-single.js';
let localEngineFrame = null;
let localEnginePort = null;
let localEngineHostPromise = null;
let localEngineHostResolve = null;
let localEngineHostReject = null;
let localEngineHostTimer = null;
let localEnginePortTimer = null;
let localEngineHostReady = false;
let localEngineUciPromise = null;
let localEngineFailure = null;
let localEngineSuppressModal = false;
let hasShownLocalEngineError = false;
let localEngineActiveSearch = null;
let localEngineSearchQueue = [];
const localEngineLineListeners = new Set();
const localWasmSearches = new Map();

const MUJAHI_DEFAULT_API_URL = 'https://mujahi-chess.onrender.com';
let mujahiProvider = null;
let hasShownMujahiError = false;

function normalizeEngineProvider(provider) {
    if (provider === 'wasm') return 'wasm';
    if (provider === 'mujahi') return 'mujahi';
    return 'api';
}
function getEngineProvider() {
    const provider = window.chessHelper?.engineProvider || localStorage.getItem('ch_engine_provider') || 'api';
    return normalizeEngineProvider(provider);
}
function getMujahiBaseUrl() {
    let baseUrl = MUJAHI_DEFAULT_API_URL;
    try {
        const custom = localStorage.getItem('ch_mujahi_api_url');
        if (custom && /^https?:\/\//i.test(custom.trim())) baseUrl = custom.trim().replace(/\/+$/, '');
    } catch (_) {}
    return baseUrl;
}
function getMujahiProvider() {
    const baseUrl = getMujahiBaseUrl();
    if (mujahiProvider && mujahiProvider.baseUrl !== baseUrl) {
        mujahiProvider.cancelAll();
        mujahiProvider = null;
    }
    if (!mujahiProvider && window.MujahiExtensionAdapter?.MujahiExtensionProvider) {
        mujahiProvider = new window.MujahiExtensionAdapter.MujahiExtensionProvider({
            baseUrl,
            debounceMs: 25,
            useSseStream: true,
            timeoutMs: 45000
        });
        mujahiProvider.warmLicenseKey?.();
    }
    return mujahiProvider;
}
function warmMujahiKey(licenseKey = null, force = false) {
    try {
        const provider = getEngineProvider();
        if (provider !== 'mujahi' && !force) return;
        const adapter = getMujahiProvider();
        adapter?.warmLicenseKey?.(licenseKey || getActiveLicenseKey(), { force });
    } catch (_) {}
}
function getActiveLicenseKey() {
    try {
        return String(localStorage.getItem('ch_active_key') || '').trim().toUpperCase();
    } catch (_) {
        return '';
    }
}
function syncQuotaFromMujahi(quota) {
    if (!quota || typeof quota !== 'object') return;
    try {
        if (quota.isPremium || quota.unlimited) {
            localStorage.setItem('ch_is_premium', 'true');
        } else {
            localStorage.setItem('ch_is_premium', 'false');
            if (typeof quota.movesRemain === 'number' && Number.isFinite(quota.movesRemain)) {
                localStorage.setItem('ch_bonus_moves', String(Math.max(0, Math.floor(quota.movesRemain))));
            }
        }
        updateMoveUI();
    } catch (_) {}
}
function testMujahiHealth() {
    const baseUrl = getMujahiBaseUrl();
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            resolve({ ok: false, status: 0, error: 'Chrome extension runtime bridge unavailable. Reload page.' });
            return;
        }
        chrome.runtime.sendMessage({ type: 'MUJAHI_HEALTH', baseUrl }, (res) => {
            const lastErr = chrome.runtime.lastError;
            if (lastErr) {
                resolve({ ok: false, status: 0, error: lastErr.message });
                return;
            }
            resolve(res || { ok: false, status: 0, error: 'No response from MV3 background worker.' });
        });
    });
}
function handleMujahiError(error) {
    const code = error?.code || '';
    const status = Number(error?.status) || 0;
    const message = error?.message || 'MUJAHI analysis request failed.';
    if (error?.name === 'AbortError') return null;

    // Transient mid-drag DOM animation positions should simply retry on next cycle without a modal
    if (code === 'INVALID_FEN') {
        log(`MUJAHI skipped transient board state: ${message}`);
        return null;
    }

    log(`MUJAHI error (${code || status || 'network'}): ${message}`);
    const isAuthError = ['LICENSE_KEY_REQUIRED', 'INVALID_KEY', 'MOVES_EXHAUSTED', 'DEPTH_LOCKED'].includes(code);
    const isCors = code === 'CORS_FORBIDDEN' || (status === 403 && !isAuthError);
    const isTerminalClient = isCors || isAuthError || status === 400 || status === 401 || status === 404 || code === 'INVALID_DEPTH';

    if (code === 'INVALID_KEY' || code === 'MOVES_EXHAUSTED') {
        try {
            localStorage.removeItem('ch_active_key');
            localStorage.setItem('ch_is_premium', 'false');
            if (code === 'MOVES_EXHAUSTED') localStorage.setItem('ch_bonus_moves', '0');
            updateMoveUI();
        } catch (_) {}
    }

    if (!hasShownMujahiError && window.showCustomModal) {
        hasShownMujahiError = true;
        const extId = error?.extensionId || (typeof chrome !== 'undefined' ? chrome.runtime?.id : '') || '<extension-id>';
        if (isCors) {
            window.showCustomModal(
                'MUJAHI API Blocked by CORS (403)',
                `Your Render backend rejected requests from extension origin chrome-extension://${extId}.\n\nQuick fix: in Render Dashboard -> Environment -> add chrome-extension://${extId} to CORS_ALLOWED_ORIGINS (or redeploy the updated backend with CORS_ALLOW_EXTENSIONS=true).`
            );
        } else if (isAuthError) {
            const title =
                code === 'DEPTH_LOCKED'
                    ? 'Depth Locked on Temporary Key'
                    : code === 'MOVES_EXHAUSTED'
                        ? 'Key Moves Exhausted'
                        : 'License Key Required';
            const body =
                code === 'DEPTH_LOCKED'
                    ? `${message}\n\nLower arrow depths to <= 7 or activate a Premium key in Get Moves.`
                    : `${message}\n\nEnter a valid M-key in Get Moves to continue using MUJAHI Cloud Stockfish 19.`;
            window.showCustomModal(title, body, 'Get Moves', () => {
                document.getElementById('ch-btn-get-moves')?.click();
            });
        } else {
            window.showCustomModal(
                'MUJAHI API Error',
                `${message} (If Render Free tier just woke up, wait 30s and click the Refresh icon, or switch provider in Settings.)`
            );
        }
    }

    return isTerminalClient ? false : null;
}
function getLocalEngineOrigin() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) throw new Error('Chrome extension runtime is unavailable.');
    return new URL(chrome.runtime.getURL('/')).origin;
}
function localEnginePost(message) {
    const payload = { channel: LOCAL_ENGINE_CHANNEL, ...message };
    if (localEnginePort) {
        localEnginePort.postMessage(payload);
        return;
    }
    if (!localEngineFrame?.contentWindow) throw new Error('Local Stockfish host is not available.');
    localEngineFrame.contentWindow.postMessage(payload, getLocalEngineOrigin());
}
function localEngineAbortError() {
    const error = new Error('Local engine analysis was cancelled.');
    error.name = 'AbortError';
    return error;
}
function waitForLocalEngineLine(predicate, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        let timer = null;
        const listener = (line, error) => {
            if (error) { cleanup(); reject(error); return; }
            if (predicate(line)) { cleanup(); resolve(line); }
        };
        const cleanup = () => {
            localEngineLineListeners.delete(listener);
            if (timer) clearTimeout(timer);
        };
        localEngineLineListeners.add(listener);
        timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for Stockfish UCI response.')); }, timeoutMs);
    });
}
function rejectLocalEngineLineWaiters(error) {
    for (const listener of [...localEngineLineListeners]) listener('', error);
}
function failLocalEngine(error) {
    const incoming = error instanceof Error ? error : new Error(String(error || 'Unknown local engine error'));
    const isGenericNotRunning = /Stockfish worker is not running/i.test(incoming.message);
    if (!localEngineFailure || !isGenericNotRunning) {
        localEngineFailure = incoming;
    }
    if (localEngineHostTimer) { clearTimeout(localEngineHostTimer); localEngineHostTimer = null; }
    if (localEnginePortTimer) { clearTimeout(localEnginePortTimer); localEnginePortTimer = null; }
    if (localEngineHostReject) {
        const reject = localEngineHostReject;
        localEngineHostResolve = localEngineHostReject = null;
        reject(localEngineFailure);
    }
    rejectLocalEngineLineWaiters(localEngineFailure);
    if (localEngineActiveSearch) finishLocalWasmSearch(localEngineActiveSearch, null, localEngineFailure);
    log(`Local Stockfish error: ${localEngineFailure.message}`);
    if (getEngineProvider() === 'wasm' && !localEngineSuppressModal && !hasShownLocalEngineError && window.showCustomModal) {
        hasShownLocalEngineError = true;
        window.showCustomModal('Local Stockfish unavailable', `${localEngineFailure.message} Check the two Stockfish 19 Lite files in the extension/engine folder, or switch back to Hosted API in Settings.`);
    }
}
function startIframeLocalEngineHost() {
    if (localEnginePortTimer) {
        clearTimeout(localEnginePortTimer);
        localEnginePortTimer = null;
    }
    if (localEnginePort) {
        try { localEnginePort.disconnect(); } catch (_) {}
        localEnginePort = null;
    }
    if (localEngineFrame) {
        localEngineFrame.remove();
        localEngineFrame = null;
    }
    const frame = document.createElement('iframe');
    frame.title = 'Chess Helper local Stockfish worker host';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed!important;width:1px!important;height:1px!important;left:-10000px!important;top:-10000px!important;border:0!important;opacity:0!important;pointer-events:none!important;';
    frame.src = chrome.runtime.getURL(LOCAL_ENGINE_HOST_PATH);
    localEngineFrame = frame;
    if (localEngineHostTimer) clearTimeout(localEngineHostTimer);
    localEngineHostTimer = setTimeout(() => failLocalEngine(new Error(`Could not load ${LOCAL_ENGINE_HOST_PATH}. Check that the engine host files are present in the extension package.`)), 20000);
    (document.documentElement || document.body).appendChild(frame);
}
function processLocalEngineHostPayload(data) {
    if (!data || data.channel !== LOCAL_ENGINE_CHANNEL) return;
    if (data.type === 'ready') {
        localEngineHostReady = true;
        localEngineFailure = null;
        if (localEnginePortTimer) { clearTimeout(localEnginePortTimer); localEnginePortTimer = null; }
        if (localEngineHostTimer) { clearTimeout(localEngineHostTimer); localEngineHostTimer = null; }
        if (localEngineHostResolve) {
            const resolve = localEngineHostResolve;
            localEngineHostResolve = localEngineHostReject = null;
            resolve(true);
        }
        return;
    }
    if (data.type === 'error') {
        if (data.fallbackIframe && localEnginePort && !localEngineHostReady) {
            startIframeLocalEngineHost();
            return;
        }
        failLocalEngine(new Error(data.message || 'Stockfish Web Worker failed to start.'));
        return;
    }
    if (data.type === 'line') {
        const line = String(data.line || '').trim();
        if (!line) return;
        for (const listener of [...localEngineLineListeners]) listener(line, null);
        if (localEngineActiveSearch) handleLocalWasmLine(localEngineActiveSearch, line);
    }
}
function handleLocalEngineHostMessage(event) {
    if (!localEngineFrame || event.source !== localEngineFrame.contentWindow) return;
    let extensionOrigin;
    try { extensionOrigin = getLocalEngineOrigin(); } catch (_) { return; }
    if (event.origin !== extensionOrigin) return;
    processLocalEngineHostPayload(event.data);
}
window.addEventListener('message', handleLocalEngineHostMessage);

function ensureLocalEngineHost() {
    if (localEngineFailure) return Promise.reject(localEngineFailure);
    if (localEngineHostReady && (localEnginePort || localEngineFrame?.isConnected)) return Promise.resolve(true);
    if (localEngineHostPromise) return localEngineHostPromise;
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return Promise.reject(new Error('This browser does not expose the extension runtime required by local WASM mode.'));

    localEngineHostPromise = new Promise((resolve, reject) => {
        localEngineHostResolve = resolve;
        localEngineHostReject = reject;
        localEngineHostTimer = setTimeout(() => failLocalEngine(new Error(`Could not load ${LOCAL_ENGINE_HOST_PATH}. Check that the engine host files are present in the extension package.`)), 20000);

        if (typeof chrome.runtime?.connect === 'function') {
            try {
                const port = chrome.runtime.connect({ name: 'local-stockfish-client' });
                localEnginePort = port;
                if (localEnginePortTimer) clearTimeout(localEnginePortTimer);
                // If an offscreen document was suspended by mobile/idle policies and doesn't answer within 2.5s,
                // fall back immediately to the inline extension iframe instead of hanging for 20s.
                localEnginePortTimer = setTimeout(() => {
                    localEnginePortTimer = null;
                    if (!localEngineHostReady && localEnginePort === port && !localEngineFrame) {
                        log('Offscreen Stockfish host timed out; falling back to extension iframe');
                        startIframeLocalEngineHost();
                    }
                }, 2500);
                port.onMessage.addListener((msg) => {
                    if (localEnginePort !== port) return;
                    processLocalEngineHostPayload(msg);
                });
                port.onDisconnect.addListener(() => {
                    if (localEnginePort !== port) return;
                    localEnginePort = null;
                    if (localEnginePortTimer) { clearTimeout(localEnginePortTimer); localEnginePortTimer = null; }
                    const errMsg = chrome.runtime.lastError?.message || '';
                    if (!localEngineHostReady && !localEngineFrame) {
                        if (/context invalidated/i.test(errMsg)) {
                            failLocalEngine(new Error('Extension was reloaded — refresh this Chess.com tab once.'));
                        } else {
                            startIframeLocalEngineHost();
                        }
                        return;
                    }
                    if (localEngineHostReady) {
                        localEngineHostReady = false;
                        localEngineUciPromise = null;
                        failLocalEngine(new Error(errMsg || 'Stockfish background port disconnected. Click Find or retry to restart.'));
                    }
                });
                return;
            } catch (_) {
                localEnginePort = null;
            }
        }

        startIframeLocalEngineHost();
    }).catch(error => {
        localEngineHostPromise = null;
        throw error;
    });
    return localEngineHostPromise;
}
async function initializeLocalEngine() {
    await ensureLocalEngineHost();
    if (localEngineUciPromise) return localEngineUciPromise;
    localEngineUciPromise = (async () => {
        const uciOk = waitForLocalEngineLine(line => line === 'uciok');
        localEnginePost({ type: 'command', command: 'uci' });
        await uciOk;
        const readyOk = waitForLocalEngineLine(line => line === 'readyok');
        localEnginePost({ type: 'command', command: 'isready' });
        await readyOk;
        return true;
    })().catch(error => {
        localEngineUciPromise = null;
        throw error;
    });
    return localEngineUciPromise;
}
function parseLocalUciInfo(fen, line) {
    const depthMatch = line.match(/(?:^|\s)depth\s+(\d+)/);
    const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)(?:\s+(lowerbound|upperbound))?/);
    const pvMatch = line.match(/\bpv\s+(.+)$/);
    if (!depthMatch || !pvMatch) return null;
    const depth = Number(depthMatch[1]);
    const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
    const multipv = multipvMatch ? Number(multipvMatch[1]) : 1;
    const seldepthMatch = line.match(/\bseldepth\s+(\d+)/);
    const nodesMatch = line.match(/\bnodes\s+(\d+)/);
    const npsMatch = line.match(/\bnps\s+(\d+)/);
    const timeMatch = line.match(/\btime\s+(\d+)/);
    const pvText = pvMatch[1].trim();
    const pvList = pvText.split(/\s+/).filter(m => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
    const move = pvList[0];
    if (!move || move === '(none)' || move === '0000') return null;
    let evaluation = null, rawCp = null, mate = null;
    const bound = scoreMatch?.[3] || 'exact';
    if (scoreMatch) {
        const scoreValue = Number(scoreMatch[2]);
        const whitePov = (fen.split(/\s+/)[1] || 'w') === 'b' ? -1 : 1;
        if (scoreMatch[1] === 'cp') {
            rawCp = scoreValue * whitePov;
            evaluation = rawCp / 100;
        } else {
            mate = scoreValue * whitePov;
        }
    }
    return {
        move,
        ponder: pvList[1] || null,
        multipv,
        evaluation: Number.isFinite(evaluation) ? evaluation : null,
        rawCp: Number.isFinite(rawCp) ? rawCp : null,
        mate: Number.isFinite(mate) ? mate : null,
        bound,
        pv: pvList,
        continuation: pvText,
        depth,
        seldepth: seldepthMatch ? Number(seldepthMatch[1]) : null,
        nodes: nodesMatch ? Number(nodesMatch[1]) : null,
        nps: npsMatch ? Number(npsMatch[1]) : null,
        time: timeMatch ? Number(timeMatch[1]) : null,
        version: 'Stockfish 19 Lite',
        raw: { uci: line }
    };
}
function settleLocalWasmWaiter(job, waiter, move, error = null) {
    if (waiter.settled) return;
    waiter.settled = true;
    if (waiter.signal && waiter.abortHandler) waiter.signal.removeEventListener('abort', waiter.abortHandler);
    job.waiters = job.waiters.filter(item => item !== waiter);
    if (error) waiter.reject(error); else waiter.resolve(move || null);
}
function resolveLocalWasmWaiters(job, analysis) {
    if (!analysis || job.isMultiPv) return;
    for (const waiter of [...job.waiters]) {
        if (analysis.depth >= waiter.depth) {
            const cacheKey = `wasm|${job.fen}|${waiter.depth}`;
            setBoundedCache(fenCache, cacheKey, analysis.move);
            settleLocalWasmWaiter(job, waiter, analysis.move);
        }
    }
}
function extractLocalMultiPvLines(job) {
    if (!job?.multiPvByDepth || !job.multiPvByDepth.size) return [];
    const depthsDesc = [...job.multiPvByDepth.keys()].sort((a, b) => b - a);
    for (const d of depthsDesc) {
        const pvMap = job.multiPvByDepth.get(d);
        const entries = [...pvMap.values()].filter(s => s && s.move);
        if (entries.length) {
            return entries.sort((a, b) => (a.multipv || 999) - (b.multipv || 999));
        }
    }
    return [];
}
function restoreLocalMultiPvDefault() {
    try {
        if ((localEnginePort || localEngineFrame?.contentWindow) && localEngineHostReady) {
            localEnginePost({ type: 'command', command: 'setoption name MultiPV value 1' });
        }
    } catch (_) {}
}
function finishLocalWasmSearch(job, moveOrPayload, error = null) {
    if (!job || job.finished) return;
    job.finished = true;
    if (job.isMultiPv) {
        restoreLocalMultiPvDefault();
        if (error) {
            for (const waiter of [...job.waiters]) settleLocalWasmWaiter(job, waiter, null, error);
        } else {
            const payload = (moveOrPayload && typeof moveOrPayload === 'object')
                ? moveOrPayload
                : { bestmove: moveOrPayload || null, terminal: !moveOrPayload, lines: extractLocalMultiPvLines(job) };
            for (const waiter of [...job.waiters]) settleLocalWasmWaiter(job, waiter, payload);
        }
    } else if (error) {
        for (const waiter of [...job.waiters]) settleLocalWasmWaiter(job, waiter, null, error);
    } else {
        const finalMove = moveOrPayload || job.latestAnalysis?.move || null;
        for (const waiter of [...job.waiters]) {
            if (job.latestAnalysis) {
                const cacheKey = `wasm|${job.fen}|${waiter.depth}`;
                setBoundedCache(fenCache, cacheKey, finalMove);
            }
            settleLocalWasmWaiter(job, waiter, finalMove);
        }
    }
    if (localEngineActiveSearch === job) localEngineActiveSearch = null;
    if (!job.isMultiPv && localWasmSearches.get(job.fen) === job) localWasmSearches.delete(job.fen);
    Promise.resolve().then(pumpLocalWasmQueue);
}
function handleLocalWasmLine(job, line) {
    if (localEngineActiveSearch !== job || job.finished) return;
    if (line.startsWith('info ')) {
        const analysis = parseLocalUciInfo(job.fen, line);
        if (!analysis) return;
        if (job.isMultiPv) {
            let pvMap = job.multiPvByDepth.get(analysis.depth);
            if (!pvMap) {
                pvMap = new Map();
                job.multiPvByDepth.set(analysis.depth, pvMap);
            }
            const existing = pvMap.get(analysis.multipv);
            if (!existing || analysis.bound === 'exact' || existing.bound !== 'exact') {
                pvMap.set(analysis.multipv, analysis);
            }
            return;
        }
        if (analysis.multipv !== 1) return;
        job.latestAnalysis = analysis;
        const prior = engineAnalysisCache.get(job.fen);
        if (!prior || analysis.depth >= (prior.depth || 0)) {
            setBoundedCache(engineAnalysisCache, job.fen, analysis, 120);
        }
        handleSuperModeEngineAnalysis(job.fen, analysis);
        resolveLocalWasmWaiters(job, analysis);
        return;
    }
    if (line.startsWith('bestmove ')) {
        const move = line.split(/\s+/)[1];
        const cleanMove = move && move !== '(none)' && move !== '0000' ? move : null;
        if (job.isMultiPv) {
            finishLocalWasmSearch(job, {
                bestmove: cleanMove,
                terminal: !cleanMove,
                lines: extractLocalMultiPvLines(job)
            });
            return;
        }
        if (job.restartDepth && job.restartDepth > (job.latestAnalysis?.depth || 0) && job.waiters.length) {
            job.started = false;
            job.startedDepth = 0;
            job.maxDepth = job.restartDepth;
            job.restartDepth = 0;
            if (localEngineActiveSearch === job) localEngineActiveSearch = null;
            localEngineSearchQueue.unshift(job);
            Promise.resolve().then(pumpLocalWasmQueue);
            return;
        }
        finishLocalWasmSearch(job, cleanMove);
    }
}
async function pumpLocalWasmQueue() {
    if (localEngineActiveSearch || !localEngineSearchQueue.length) return;
    const job = localEngineSearchQueue.shift();
    if (!job || job.finished) { Promise.resolve().then(pumpLocalWasmQueue); return; }
    if (!job.waiters.length) {
        if (!job.isMultiPv && localWasmSearches.get(job.fen) === job) localWasmSearches.delete(job.fen);
        Promise.resolve().then(pumpLocalWasmQueue);
        return;
    }
    localEngineActiveSearch = job;
    try {
        await initializeLocalEngine();
        if (localEngineActiveSearch !== job || job.finished) return;
        if (!job.waiters.length) { finishLocalWasmSearch(job, null); return; }
        job.started = true;
        job.startedDepth = job.maxDepth;
        if (job.isMultiPv) {
            localEnginePost({ type: 'command', command: `setoption name MultiPV value ${job.multiPv}` });
        } else {
            localEnginePost({ type: 'command', command: 'setoption name MultiPV value 1' });
        }
        localEnginePost({ type: 'command', command: `position fen ${job.fen}` });
        const moveFilter = job.isMultiPv && Array.isArray(job.searchMoves) && job.searchMoves.length
            ? ` searchmoves ${job.searchMoves.join(' ')}`
            : '';
        localEnginePost({ type: 'command', command: `go depth ${job.startedDepth}${moveFilter}` });
    } catch (error) {
        if (!localEngineFailure) failLocalEngine(error);
        else finishLocalWasmSearch(job, null, error);
    }
}
function runLocalWasmMultiPv(fen, { depth = 7, multiPv = 24, searchMoves = null, signal = null } = {}) {
    if (signal?.aborted) return Promise.reject(localEngineAbortError());
    if (localEngineFailure) return Promise.reject(localEngineFailure);
    const clampedMultiPv = Math.max(1, Math.min(40, Number.parseInt(multiPv, 10) || 1));
    const safeMoves = Array.isArray(searchMoves)
        ? searchMoves.filter(m => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(String(m || '')))
        : null;
    return new Promise((resolve, reject) => {
        const job = {
            isMultiPv: true,
            fen,
            maxDepth: Math.max(1, Math.min(18, Number.parseInt(depth, 10) || 7)),
            multiPv: clampedMultiPv,
            searchMoves: safeMoves,
            multiPvByDepth: new Map(),
            startedDepth: 0,
            started: false,
            finished: false,
            waiters: [],
            latestAnalysis: null
        };
        const waiter = { depth: job.maxDepth, signal, resolve, reject, settled: false, abortHandler: null };
        job.waiters.push(waiter);
        if (signal) {
            waiter.abortHandler = () => {
                settleLocalWasmWaiter(job, waiter, null, localEngineAbortError());
                if (!job.waiters.length) {
                    if (localEngineActiveSearch === job) {
                        try { localEnginePost({ type: 'command', command: 'stop' }); } catch (_) {}
                    } else {
                        localEngineSearchQueue = localEngineSearchQueue.filter(item => item !== job);
                    }
                }
            };
            signal.addEventListener('abort', waiter.abortHandler, { once: true });
            if (signal.aborted) { waiter.abortHandler(); return; }
        }
        localEngineSearchQueue.push(job);
        Promise.resolve().then(pumpLocalWasmQueue);
    });
}
function fetchLocalWasmBestMove(fen, depth, signal, cacheKey) {
    if (signal?.aborted) return Promise.resolve(null);
    if (localEngineFailure) return Promise.reject(localEngineFailure);
    return new Promise((resolve, reject) => {
        let job = localWasmSearches.get(fen);
        if (!job) {
            job = { fen, maxDepth: depth, startedDepth: 0, started: false, finished: false, waiters: [], latestAnalysis: null };
            localWasmSearches.set(fen, job);
            localEngineSearchQueue.push(job);
        } else {
            job.maxDepth = Math.max(job.maxDepth, depth);
        }
        const waiter = { depth, signal, resolve, reject, settled: false, abortHandler: null };
        job.waiters.push(waiter);
        if (signal) {
            waiter.abortHandler = () => {
                settleLocalWasmWaiter(job, waiter, null, localEngineAbortError());
                if (!job.waiters.length) {
                    if (localEngineActiveSearch === job) {
                        try { localEnginePost({ type: 'command', command: 'stop' }); } catch (_) {}
                    } else {
                        localEngineSearchQueue = localEngineSearchQueue.filter(item => item !== job);
                        if (localWasmSearches.get(fen) === job) localWasmSearches.delete(fen);
                    }
                }
            };
            signal.addEventListener('abort', waiter.abortHandler, { once: true });
            if (signal.aborted) { waiter.abortHandler(); return; }
        }
        if (job.latestAnalysis && job.latestAnalysis.depth >= depth) {
            const latest = job.latestAnalysis;
            setBoundedCache(fenCache, cacheKey, latest.move);
            settleLocalWasmWaiter(job, waiter, latest.move);
            return;
        }
        if (!job.started) Promise.resolve().then(pumpLocalWasmQueue);
        else if (job.maxDepth > job.startedDepth) {
            // A later higher-depth request on the same FEN restarts the active search once,
            // preserving existing waiters and any shallower results already delivered.
            job.restartDepth = Math.max(job.restartDepth || 0, job.maxDepth);
            try { localEnginePost({ type: 'command', command: 'stop' }); } catch (_) {}
        }
    });
}

const START_BOARD_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
let activeAnalysisController = null;
let cachedBoard = null;
let lastFenWasNativeComplete = false;
let trackedCastling = null;
let trackedCastlingBoard = null;
function clearFenCache() {
    fenCache.clear();
    lichessFenCache.clear();
    engineAnalysisCache.clear();
    superModeAuxCache.clear();
    superModeSnapshotsByFen.clear();
    softMistakesCache.clear();
    softMistakesSelectedMove = '';
    softMistakesLastState = { fen: '', status: 'Click Find when you want mild mistakes', candidates: [], sourceLabel: '' };
    trackedCastling = null;
    trackedCastlingBoard = null;
    log("FEN cache cleared");
}

// --- FREEMIUM ---
function updateMoveUI() {
    const isPremium = localStorage.getItem('ch_is_premium') === 'true';
    const textEl = document.getElementById('ch-move-counter-text');
    const keyDisplay = document.getElementById('ch-active-key-display');
    let activeKey = localStorage.getItem('ch_active_key');
    if (!textEl) return;
    if (isPremium) {
        textEl.innerText = "Moves: Unlimited 💎";
        textEl.style.color = "#FFD700";
        if (keyDisplay) {
            if (activeKey) {
                keyDisplay.style.display = 'flex';
                document.getElementById('ch-active-key-name').innerText = activeKey;
                document.getElementById('ch-active-key-moves').innerText = "∞";
            } else { keyDisplay.style.display = 'none'; }
        }
        return;
    }
    const count = parseInt(localStorage.getItem('ch_move_count') || '0');
    let bonus = parseInt(localStorage.getItem('ch_bonus_moves') || '0');
    const cooldownStart = parseInt(localStorage.getItem('ch_cooldown_start') || '0');
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const now = Date.now();
    if (bonus <= 0 && activeKey) { localStorage.removeItem('ch_active_key'); activeKey = null; }
    if (keyDisplay) {
        if (bonus > 0 && activeKey) {
            keyDisplay.style.display = 'flex';
            document.getElementById('ch-active-key-name').innerText = activeKey;
            document.getElementById('ch-active-key-moves').innerText = bonus;
        } else { keyDisplay.style.display = 'none'; }
    }
    if (cooldownStart > 0 && count >= 200 && bonus <= 0) {
        const timePassed = now - cooldownStart;
        if (timePassed >= SIX_HOURS) {
            localStorage.setItem('ch_move_count', '0');
            localStorage.setItem('ch_cooldown_start', '0');
            hasShownExhaustModal = false;
            textEl.innerText = `Moves: 0/200`;
            if (countdownInterval) clearInterval(countdownInterval);
        } else {
            const timeLeft = SIX_HOURS - timePassed;
            const h = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
            const m = Math.floor((timeLeft / 1000 / 60) % 60);
            const s = Math.floor((timeLeft / 1000) % 60);
            textEl.innerText = `Resets in ${h}:${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
            textEl.style.color = "#ff4444";
            if (!countdownInterval) countdownInterval = setInterval(updateMoveUI, 1000);
        }
    } else {
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
        textEl.style.color = "var(--ch-text-secondary)";
        textEl.innerText = bonus > 0 ? `Moves: ${count}/200 (+${bonus} Bonus)` : `Moves: ${count}/200`;
    }
}

function checkFreemiumLimit() {
    const isPremium = localStorage.getItem('ch_is_premium') === 'true';
    if (isPremium) return true;
    const count = parseInt(localStorage.getItem('ch_move_count') || '0');
    let bonus = parseInt(localStorage.getItem('ch_bonus_moves') || '0');
    const cooldownStart = parseInt(localStorage.getItem('ch_cooldown_start') || '0');
    const now = Date.now();
    if (count >= 200 && bonus > 0) { localStorage.setItem('ch_bonus_moves', bonus - 1); return true; }
    if (count >= 200) {
        if (cooldownStart === 0) localStorage.setItem('ch_cooldown_start', now.toString());
        if (window.showCustomModal && !hasShownExhaustModal) {
            hasShownExhaustModal = true;
            window.showCustomModal("Moves Exhausted", "You've used your 200 free moves! Wait 6 hours, get a free key by watching an ad, or unlock Premium.", "Get Moves", () => {
                document.getElementById('ch-btn-get-moves').click();
            });
        }
        return false;
    }
    return true;
}

async function recordMoveUsage() {
    const isPremium = localStorage.getItem('ch_is_premium') === 'true';
    const activeKey = localStorage.getItem('ch_active_key');
    const count = parseInt(localStorage.getItem('ch_move_count') || '0');
    // When using MUJAHI Cloud Stockfish, Render atomically verifies & deducts moves server-side
    // via /api/internal/authorize-engine and syncs remaining quota back via analysis.quota.
    if (!isPremium && activeKey && getEngineProvider() !== 'mujahi') {
        try { fetch('https://xndroid.store/api/consume-move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: activeKey }) }); }
        catch (e) { console.error("Sync failed", e); }
    }
    if (isPremium) return;
    if (count < 200) localStorage.setItem('ch_move_count', count + 1);
    updateMoveUI();
}

// --- DOM UTILS (cached board + scoped queries) ---
function getBoard() {
    if (cachedBoard?.isConnected) return cachedBoard;
    cachedBoard = document.querySelector('wc-chess-board') || document.querySelector('.board') || document.querySelector('chess-board');
    return cachedBoard;
}
function getSquareRect(square) { const board = getBoard(); if (!board) return null; const rect = board.getBoundingClientRect(); const size = rect.width / 8; const isFlipped = board.classList.contains('flipped'); const file = colToNum[square[0]]; const rank = parseInt(square[1]); let x, y; if (isFlipped) { x = (8 - file) * size; y = (rank - 1) * size; } else { x = (file - 1) * size; y = (8 - rank) * size; } return { centerX: rect.left + x + size / 2, centerY: rect.top + y + size / 2 }; }
function algToSquareClass(sq) { return `square-${colToNum[sq[0]]}${sq[1]}`; }
function getPieceElementOnSquare(sq) { const board = getBoard(); return board?.querySelector(`.piece.${algToSquareClass(sq)}`) || null; }
function isMyPieceOnSquare(sq) { const el = getPieceElementOnSquare(sq); if (!el) return false; const my = getMyColor(); return el.classList.contains(`${my}p`) || el.classList.contains(`${my}n`) || el.classList.contains(`${my}b`) || el.classList.contains(`${my}r`) || el.classList.contains(`${my}q`) || el.classList.contains(`${my}k`); }
function getMyColor() { const board = getBoard(); if (!board) return 'w'; return board.classList.contains('flipped') ? 'b' : 'w'; }
function getActiveColor(board = getBoard()) { if (!board) return 'w'; const highlights = board.querySelectorAll('.highlight'); for (const hl of highlights) { const hlClass = Array.from(hl.classList).find(c => c.startsWith('square-')); if (!hlClass) continue; const piece = board.querySelector(`.piece.square-${hlClass.split('-')[1]}`); if (!piece) continue; if ([...piece.classList].some(c => c.startsWith('w'))) return 'b'; if ([...piece.classList].some(c => c.startsWith('b'))) return 'w'; } return 'w'; }
function getNativeFullFen(boardEl) {
    const candidates = [];
    for (const method of ['getFen', 'getFEN', 'fen']) {
        try { if (typeof boardEl?.[method] === 'function') candidates.push(boardEl[method]()); } catch (_) {}
    }
    for (const value of [boardEl?.fen, boardEl?.position, boardEl?.getAttribute?.('fen'), boardEl?.getAttribute?.('data-fen'), boardEl?.dataset?.fen]) {
        if (typeof value === 'string') candidates.push(value);
    }
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const fields = candidate.trim().split(/\s+/);
        if (fields.length < 4 || !/^[prnbqkPRNBQK1-8/]+$/.test(fields[0]) || !/^[wb]$/.test(fields[1]) || !/^(?:-|K?Q?k?q?)$/.test(fields[2]) || !/^(?:-|[a-h][36])$/.test(fields[3])) continue;
        return [...fields.slice(0, 4), fields[4] || '0', fields[5] || '1'].join(' ');
    }
    return null;
}
function inferCastlingFromPlacement(placement) {
    if (!placement) return '-';
    const rows = placement.split('/');
    if (rows.length !== 8) return '-';
    const expandRow = (rowStr) => {
        let out = '';
        for (const ch of rowStr) {
            if (/^[1-8]$/.test(ch)) out += '.'.repeat(Number(ch));
            else out += ch;
        }
        return out;
    };
    const r8 = expandRow(rows[0]);
    const r1 = expandRow(rows[7]);
    if (r8.length !== 8 || r1.length !== 8) return '-';
    let rights = '';
    if (r1[4] === 'K') {
        if (r1[7] === 'R') rights += 'K';
        if (r1[0] === 'R') rights += 'Q';
    }
    if (r8[4] === 'k') {
        if (r8[7] === 'r') rights += 'k';
        if (r8[0] === 'r') rights += 'q';
    }
    return rights || '-';
}
function getCloudLookupFens(fen) {
    if (!fen) return [];
    const fields = fen.trim().split(/\s+/);
    if (fields.length < 4) return [fen];
    const rest = [fields[3] || '-', fields[4] || '0', fields[5] || '1'];
    if (fields[2] === '-') {
        const inferred = inferCastlingFromPlacement(fields[0]);
        if (inferred !== '-') {
            return [[fields[0], fields[1], inferred, ...rest].join(' '), fen];
        }
        return [fen];
    }
    if (!lastFenWasNativeComplete) {
        return [fen, [fields[0], fields[1], '-', ...rest].join(' ')];
    }
    return [fen];
}
function getFEN() {
    const boardEl = getBoard();
    if (!boardEl) return null;
    const nativeFen = getNativeFullFen(boardEl);
    if (nativeFen) { lastFenWasNativeComplete = true; return nativeFen; }
    lastFenWasNativeComplete = false;
    const pieces = boardEl.querySelectorAll('.piece');
    if (!pieces.length) return null;
    const board = Array(64).fill(null);
    for (const piece of pieces) {
        let type = null, square = null;
        for (const cls of piece.classList) {
            if (!type && pieceToFen[cls]) type = pieceToFen[cls];
            else if (!square && cls.startsWith('square-')) square = cls.slice(7);
        }
        if (type && square && /^[1-8][1-8]$/.test(square)) {
            const file = Number(square[0]) - 1, rank = Number(square[1]);
            board[(8-rank)*8+file] = type;
        }
    }
    const rows = [];
    for (let r=0; r<8; r++) {
        let empty=0, row='';
        for (let c=0; c<8; c++) {
            const value=board[r*8+c];
            if (value===null) empty++;
            else { if (empty) { row+=empty; empty=0; } row+=value; }
        }
        if (empty) row+=empty;
        rows.push(row);
    }
    const placement = rows.join('/');
    if (trackedCastlingBoard !== boardEl) {
        trackedCastlingBoard = boardEl;
        trackedCastling = null;
    }
    if (placement === START_BOARD_PLACEMENT) {
        trackedCastling = { K: true, Q: true, k: true, q: true };
    } else if (trackedCastling) {
        if (board[60] !== 'K') { trackedCastling.K = false; trackedCastling.Q = false; }
        if (board[63] !== 'R') trackedCastling.K = false;
        if (board[56] !== 'R') trackedCastling.Q = false;
        if (board[4] !== 'k')  { trackedCastling.k = false; trackedCastling.q = false; }
        if (board[7] !== 'r')  trackedCastling.k = false;
        if (board[0] !== 'r')  trackedCastling.q = false;
    }
    let castlingStr = '-';
    if (trackedCastling) {
        const built = `${trackedCastling.K ? 'K' : ''}${trackedCastling.Q ? 'Q' : ''}${trackedCastling.k ? 'k' : ''}${trackedCastling.q ? 'q' : ''}`;
        castlingStr = built || '-';
    }
    return `${placement} ${getActiveColor(boardEl)} ${castlingStr} - 0 1`;
}

// --- API CALLS ---
const MAX_API_RETRIES = 2; // retries after the first attempt
const RETRY_BASE_MS = 500;
const BG_AUX_FETCH_HOSTS = new Set(['lichess.org', 'explorer.lichess.org', 'tablebase.lichess.ovh']);
function retryDelay(response, attempt) {
    const retryAfter = response?.headers?.get?.('Retry-After');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) return Math.min(60000, Math.max(250, seconds * 1000));
        const dateDelay = Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(dateDelay) && dateDelay > 0) return Math.min(60000, dateDelay);
    }
    return Math.min(8000, RETRY_BASE_MS * (2 ** attempt));
}
function reportHttpError(service, status) {
    if (status === 429) log(`${service}: HTTP 429 rate limited; retrying with backoff`);
    else if (status === 401) log(`${service}: HTTP 401 unauthorized; check API access`);
    else if (status === 403) log(`${service}: HTTP 403 forbidden; request blocked`);
    else if (status >= 500) log(`${service}: HTTP ${status} server error; retrying`);
    else log(`${service}: HTTP ${status}`);
}
function isBgAuxHostUrl(url) {
    try {
        const u = new URL(String(url));
        return u.protocol === 'https:' && BG_AUX_FETCH_HOSTS.has(u.hostname);
    } catch (_) {
        return false;
    }
}
function fetchJsonViaBackground(url, signal = null) {
    if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        return new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => {
                if (settled) return;
                settled = true;
                const err = new Error('Aborted');
                err.name = 'AbortError';
                reject(err);
            };
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            try {
                chrome.runtime.sendMessage({ type: 'FETCH_JSON', url }, (res) => {
                    if (signal) signal.removeEventListener('abort', onAbort);
                    if (settled || signal?.aborted) return;
                    settled = true;
                    const lastErr = chrome.runtime.lastError;
                    if (lastErr) {
                        reject(new Error(lastErr.message));
                        return;
                    }
                    if (!res) {
                        reject(new Error('No response from extension service worker'));
                        return;
                    }
                    resolve({
                        ok: Boolean(res.ok),
                        status: Number(res.status) || 0,
                        data: res.data ?? null,
                        error: res.error || '',
                        headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? (res.retryAfter || null) : null) },
                        async json() { return res.data ?? null; }
                    });
                });
            } catch (err) {
                if (signal) signal.removeEventListener('abort', onAbort);
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            }
        });
    }
    return fetch(url, { signal, headers: { Accept: 'application/json' } });
}
async function fetchJsonWithRetry(url, options, service) {
    const useBg = isBgAuxHostUrl(url) && typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';
    for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
        if (options?.signal?.aborted) return null;
        try {
            const res = useBg ? await fetchJsonViaBackground(url, options?.signal) : await fetch(url, options);
            if (res.ok) return await res.json();
            reportHttpError(service, res.status);
            // Authentication/permission and other client errors won't improve by retrying.
            const retryable = res.status === 429 || res.status >= 500;
            if (!retryable) return false; // terminal client/auth error: report once, don't hammer the endpoint
            if (attempt === MAX_API_RETRIES) return null;
            await sleep(retryDelay(res, attempt));
        } catch (e) {
            if (e?.name === 'AbortError' || options?.signal?.aborted) return null;
            console.warn(`[${service}] Network error (attempt ${attempt + 1}/${MAX_API_RETRIES + 1})`, e);
            if (attempt === MAX_API_RETRIES) return null;
            await sleep(Math.min(8000, RETRY_BASE_MS * (2 ** attempt)));
        }
    }
    return null;
}

function getSoftMistakesConfig() {
    const cfg = window.chessHelper || {};
    const sm = cfg.softMistakes || {};
    const minDropCp = Math.max(10, Math.min(300, Number.parseInt(sm.minDropCp, 10) || 25));
    const maxDropCp = Math.max(minDropCp, Math.min(400, Number.parseInt(sm.maxDropCp, 10) || 85));
    const maxResults = Math.max(1, Math.min(4, Number.parseInt(sm.maxResults, 10) || 3));
    return {
        enabled: cfg.masterToggle !== false && !!cfg.superModeEnabled && !!cfg.superModeFeatures?.softMistakes,
        minDropCp,
        maxDropCp,
        maxResults
    };
}

function getMoverCpFromLocalLine(line, activeColor) {
    if (!line || line.mate !== null) return null;
    const whiteCp = Number.isFinite(line.rawCp)
        ? line.rawCp
        : Number.isFinite(line.evaluation)
            ? Math.round(line.evaluation * 100)
            : null;
    if (whiteCp === null || !Number.isFinite(whiteCp)) return null;
    const povFactor = activeColor === 'b' ? -1 : 1;
    return { cp: whiteCp * povFactor, whiteCp };
}

function selectStage1SoftMistakeShortlist(lines, activeColor, minDropCp, maxDropCp, limit = 4) {
    const sorted = (Array.isArray(lines) ? lines : []).filter(l => l && l.move).sort((a, b) => (a.multipv || 999) - (b.multipv || 999));
    if (!sorted.length) return { bestLine: null, shortlist: [], reason: 'no_moves' };
    const bestLine = sorted[0];
    const bestScore = getMoverCpFromLocalLine(bestLine, activeColor);
    if (!bestScore) {
        return { bestLine, shortlist: [], reason: bestLine.mate !== null ? 'mate_position' : 'no_score' };
    }
    const looseMin = Math.max(10, minDropCp - 20);
    const looseMax = maxDropCp + 40;
    const seen = new Set([bestLine.move]);
    const hits = [];
    for (let i = 1; i < sorted.length; i++) {
        const line = sorted[i];
        if (!line.move || seen.has(line.move)) continue;
        seen.add(line.move);
        const score = getMoverCpFromLocalLine(line, activeColor);
        if (!score) continue;
        const dropCp = bestScore.cp - score.cp;
        if (dropCp >= looseMin && dropCp <= looseMax) {
            hits.push({ move: line.move, dropCp });
        }
    }
    hits.sort((a, b) => {
        const aIn = a.dropCp >= minDropCp && a.dropCp <= maxDropCp ? 0 : 1;
        const bIn = b.dropCp >= minDropCp && b.dropCp <= maxDropCp ? 0 : 1;
        if (aIn !== bIn) return aIn - bIn;
        return a.dropCp - b.dropCp;
    });
    const shortlist = hits.slice(0, limit).map(h => h.move);
    let reason = 'ok';
    if (!shortlist.length) {
        const secondScore = sorted[1] ? getMoverCpFromLocalLine(sorted[1], activeColor) : null;
        const secondDrop = secondScore ? bestScore.cp - secondScore.cp : null;
        reason = sorted.length <= 1 ? 'only_move' : (secondDrop !== null && secondDrop > maxDropCp ? 'forced_best_move' : 'no_match_in_range');
    }
    return { bestLine, shortlist, reason };
}

function finalizeLocalSoftMistakeCandidates(lines, bestMoveHint, activeColor, minDropCp, maxDropCp, maxResults) {
    const sorted = (Array.isArray(lines) ? lines : []).filter(l => l && l.move).sort((a, b) => (a.multipv || 999) - (b.multipv || 999));
    if (!sorted.length) return { bestMove: bestMoveHint, candidates: [], reason: 'no_moves' };
    let anchorLine = sorted[0];
    let anchorScore = getMoverCpFromLocalLine(anchorLine, activeColor);
    if (bestMoveHint) {
        const hinted = sorted.find(l => l.move === bestMoveHint);
        const hintedScore = getMoverCpFromLocalLine(hinted, activeColor);
        if (hinted && hintedScore && (!anchorScore || hintedScore.cp >= anchorScore.cp)) {
            anchorLine = hinted;
            anchorScore = hintedScore;
        }
    }
    if (!anchorScore) {
        return { bestMove: anchorLine.move || bestMoveHint, candidates: [], reason: anchorLine.mate !== null ? 'mate_position' : 'no_score' };
    }
    const matches = [];
    const seen = new Set([anchorLine.move]);
    for (const line of sorted) {
        if (!line.move || seen.has(line.move)) continue;
        seen.add(line.move);
        const score = getMoverCpFromLocalLine(line, activeColor);
        if (!score) continue;
        const dropCp = Math.round(anchorScore.cp - score.cp);
        if (dropCp < minDropCp || dropCp > maxDropCp) continue;
        matches.push({
            move: line.move,
            dropCp,
            dropPawns: Number((dropCp / 100).toFixed(2)),
            evalCp: score.whiteCp,
            evalPawns: Number((score.whiteCp / 100).toFixed(2))
        });
    }
    matches.sort((a, b) => a.dropCp - b.dropCp);
    return {
        bestMove: anchorLine.move,
        candidates: matches.slice(0, maxResults),
        reason: matches.length ? 'ok' : 'no_match_in_range'
    };
}

function softMistakeReasonMessage(reason, cfg) {
    const minStr = (cfg.minDropCp / 100).toFixed(2);
    const maxStr = (cfg.maxDropCp / 100).toFixed(2);
    if (reason === 'forced_best_move' || reason === 'only_move') return 'Forced best move (no mild mistake)';
    if (reason === 'mate_position') return 'Mate line active (skipped)';
    if (reason === 'terminal') return 'Game position is terminal';
    return `None found in −${minStr}..−${maxStr}`;
}

function buildSoftMistakeChip(cand, state) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ch-soft-mistake-chip${softMistakesSelectedMove === cand.move ? ' is-active' : ''}`;
    const dropPawns = Number.isFinite(Number(cand.dropPawns)) ? Number(cand.dropPawns) : (Number(cand.dropCp || 0) / 100);
    const evalPawns = Number.isFinite(Number(cand.evalPawns)) ? Number(cand.evalPawns) : (Number(cand.evalCp || 0) / 100);
    btn.title = `${fmtMoveArrow(cand.move)}: drops ${dropPawns.toFixed(2)} pawns · new eval ${evalPawns >= 0 ? '+' : ''}${evalPawns.toFixed(2)} (click to play move)`;

    const moveEl = document.createElement('strong');
    moveEl.textContent = fmtMoveArrow(cand.move);
    const dropEl = document.createElement('span');
    dropEl.className = 'ch-sm-drop';
    dropEl.textContent = `−${dropPawns.toFixed(2)}`;
    const evalEl = document.createElement('span');
    evalEl.className = 'ch-sm-eval';
    evalEl.textContent = `${evalPawns >= 0 ? '+' : ''}${evalPawns.toFixed(2)}`;

    btn.append(moveEl, dropEl, evalEl);
    btn.addEventListener('mouseenter', () => {
        softMistakesSelectedMove = cand.move;
        window.drawArrow?.('softMistake', cand.move);
    });
    btn.addEventListener('mouseleave', () => {
        if (softMistakesSelectedMove === cand.move) {
            softMistakesSelectedMove = '';
            window.clearArrow?.('softMistake');
        }
    });
    btn.addEventListener('click', async () => {
        const liveFen = getFEN();
        const scannedFen = state.fen || softMistakesCurrentFen;
        if (!liveFen || (scannedFen && liveFen !== scannedFen)) {
            renderSoftMistakesState({ fen: liveFen || '', status: 'Board changed — click Find again', candidates: [], sourceLabel: '' });
            return;
        }
        if ((liveFen.split(' ')[1] || 'w') !== getMyColor()) {
            window.showCustomModal?.('Wait for your turn', 'You can only play a soft-mistake move on your turn.');
            return;
        }
        softMistakesSelectedMove = '';
        window.clearArrow?.('softMistake');
        for (const chip of document.querySelectorAll('#chess-helper-root .ch-soft-mistake-chip')) chip.disabled = true;
        try {
            await makeMove(cand.move);
        } finally {
            clearSoftMistakes();
        }
    });
    return btn;
}

function clearSoftMistakes() {
    if (softMistakesController) {
        softMistakesController.abort();
        softMistakesController = null;
    }
    softMistakesSelectedMove = '';
    window.clearArrow?.('softMistake');
    const liveFen = getFEN() || '';
    renderSoftMistakesState({ fen: liveFen, status: liveFen ? 'Click Find for this turn' : 'Click Find when you want mild mistakes', candidates: [], sourceLabel: '' });
}

function renderSoftMistakesState(state = softMistakesLastState) {
    softMistakesLastState = state;
    const card = document.getElementById('ch-soft-mistakes-card');
    const list = document.getElementById('ch-soft-mistakes-list');
    const rangeLabel = document.getElementById('ch-soft-mistakes-range-label');
    const findBtn = document.getElementById('ch-btn-find-soft-mistakes');

    const dock = document.getElementById('ch-soft-mistakes-dock');
    const dockList = document.getElementById('ch-dock-soft-mistakes-list');
    const dockRangeLabel = document.getElementById('ch-dock-soft-mistakes-range');
    const dockFindBtn = document.getElementById('ch-dock-find-soft-mistakes');
    const dockClearBtn = document.getElementById('ch-dock-clear-soft-mistakes');
    if (!card && !dock) return;

    const cfg = getSoftMistakesConfig();
    if (!cfg.enabled) {
        if (card) card.style.display = 'none';
        if (dock) dock.style.display = 'none';
        return;
    }

    const minStr = (cfg.minDropCp / 100).toFixed(2);
    const maxStr = (cfg.maxDropCp / 100).toFixed(2);
    const rangeText = `−${minStr}..−${maxStr}${state.sourceLabel ? ` · ${state.sourceLabel}` : ''}`;
    const candidates = Array.isArray(state.candidates) ? state.candidates : [];

    if (card) card.style.display = 'block';
    if (dock) dock.style.display = 'block';
    if (rangeLabel) rangeLabel.textContent = rangeText;
    if (dockRangeLabel) dockRangeLabel.textContent = rangeText;

    for (const btn of [findBtn, dockFindBtn]) {
        if (!btn) continue;
        btn.disabled = Boolean(state.loading);
        btn.textContent = state.loading ? 'Scanning…' : 'Find';
    }

    if (candidates.length && !softMistakesSelectedMove) {
        softMistakesSelectedMove = candidates[0].move;
        window.drawArrow?.('softMistake', candidates[0].move);
    }

    if (list) {
        list.replaceChildren();
        if (!candidates.length) {
            const item = document.createElement('span');
            item.className = 'ch-soft-mistakes-status';
            item.textContent = state.status || 'Click Find when you want mild mistakes';
            list.appendChild(item);
        } else {
            for (const cand of candidates) list.appendChild(buildSoftMistakeChip(cand, state));
        }
    }

    if (dockList) {
        dockList.replaceChildren();
        const isIdlePrompt = !state.loading && !candidates.length && (!state.status || /^Click Find /i.test(state.status));
        if (dockClearBtn) {
            dockClearBtn.style.display = (!isIdlePrompt && !state.loading) ? 'inline-block' : 'none';
        }
        if (candidates.length) {
            for (const cand of candidates) dockList.appendChild(buildSoftMistakeChip(cand, state));
        } else if (!isIdlePrompt && state.status) {
            const item = document.createElement('span');
            item.className = 'ch-soft-mistakes-status';
            item.textContent = state.status;
            dockList.appendChild(item);
        }
    }
}

function refreshSoftMistakesCard() {
    renderSoftMistakesState(softMistakesLastState);
}

function syncSoftMistakesForFen(fen) {
    if (!fen) {
        softMistakesCurrentFen = '';
        softMistakesSelectedMove = '';
        if (softMistakesController) softMistakesController.abort();
        softMistakesController = null;
        window.clearArrow?.('softMistake');
        renderSoftMistakesState({ fen: '', status: 'Click Find when you want mild mistakes', candidates: [], sourceLabel: '' });
        return;
    }
    if (fen === softMistakesCurrentFen) {
        refreshSoftMistakesCard();
        return;
    }
    softMistakesCurrentFen = fen;
    softMistakesSelectedMove = '';
    if (softMistakesController) softMistakesController.abort();
    softMistakesController = null;
    window.clearArrow?.('softMistake');
    // Strictly on-demand: never auto-scan when the board changes; prompt user to click Find.
    renderSoftMistakesState({ fen, status: 'Click Find for this turn', candidates: [], sourceLabel: '' });
}

function fetchMujahiSoftMistakes(fen, cfg, signal) {
    const baseUrl = getMujahiBaseUrl();
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(localEngineAbortError()); return; }
        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            reject(new Error('Extension runtime bridge unavailable.'));
            return;
        }
        let settled = false;
        const onAbort = () => {
            if (settled) return;
            settled = true;
            reject(localEngineAbortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        chrome.runtime.sendMessage({
            type: 'MUJAHI_SOFT_MISTAKES',
            baseUrl,
            fen,
            minDropCp: cfg.minDropCp,
            maxDropCp: cfg.maxDropCp,
            maxResults: cfg.maxResults,
            timeoutMs: 30000,
            licenseKey: getActiveLicenseKey()
        }, (res) => {
            signal?.removeEventListener('abort', onAbort);
            if (settled || signal?.aborted) return;
            settled = true;
            const lastErr = chrome.runtime.lastError;
            if (lastErr) { reject(new Error(lastErr.message)); return; }
            if (!res?.ok) {
                const err = new Error(res?.error || 'MUJAHI soft mistakes failed');
                err.status = Number(res?.status) || 0;
                err.code = res?.code || '';
                reject(err);
                return;
            }
            if (res.payload?.quota) syncQuotaFromMujahi(res.payload.quota);
            resolve(res.payload);
        });
    });
}

async function runLocalWasmSoftMistakes(fen, cfg, signal) {
    const activeColor = (fen.split(/\s+/)[1] || 'w') === 'b' ? 'b' : 'w';
    const stage1 = await runLocalWasmMultiPv(fen, { depth: 7, multiPv: 24, signal });
    if (stage1?.terminal) {
        return { candidates: [], reason: 'terminal', sourceLabel: 'SF19 Local' };
    }
    const { bestLine, shortlist, reason } = selectStage1SoftMistakeShortlist(
        stage1?.lines || [],
        activeColor,
        cfg.minDropCp,
        cfg.maxDropCp,
        Math.max(4, cfg.maxResults + 1)
    );
    if (!shortlist.length) {
        return { candidates: [], reason, sourceLabel: 'SF19 Local' };
    }
    const searchMoves = [bestLine.move, ...shortlist];
    const stage2 = await runLocalWasmMultiPv(fen, {
        depth: 10,
        multiPv: searchMoves.length,
        searchMoves,
        signal
    });
    const out = finalizeLocalSoftMistakeCandidates(
        stage2?.lines || [],
        bestLine.move,
        activeColor,
        cfg.minDropCp,
        cfg.maxDropCp,
        cfg.maxResults
    );
    return { ...out, sourceLabel: 'SF19 Local' };
}

async function runLocalWasmSoftMistakesWithRetry(fen, cfg, signal) {
    if (localEngineFailure) {
        resetLocalEngineRuntime({ terminate: true, error: localEngineAbortError() });
    }
    const prevSuppress = localEngineSuppressModal;
    localEngineSuppressModal = true;
    try {
        return await runLocalWasmSoftMistakes(fen, cfg, signal);
    } finally {
        localEngineSuppressModal = prevSuppress;
    }
}

async function findSoftMistakes() {
    const cfg = getSoftMistakesConfig();
    if (!cfg.enabled) { refreshSoftMistakesCard(); return; }
    const fen = getFEN();
    if (!fen) {
        renderSoftMistakesState({ fen: '', status: 'Open a live board first', candidates: [], sourceLabel: '' });
        return;
    }

    softMistakesCurrentFen = fen;
    softMistakesSelectedMove = '';
    window.clearArrow?.('softMistake');

    const provider = getEngineProvider();
    const cacheKey = `${provider}|${fen}|${cfg.minDropCp}|${cfg.maxDropCp}|${cfg.maxResults}`;
    const cached = softMistakesCache.get(cacheKey);
    if (cached) {
        renderSoftMistakesState({ fen, ...cached });
        return;
    }

    if (softMistakesController) softMistakesController.abort();
    const controller = new AbortController();
    softMistakesController = controller;
    renderSoftMistakesState({ fen, loading: true, status: 'Scanning 2-stage moves…', candidates: [], sourceLabel: '' });

    try {
        let result = null;
        if (provider === 'mujahi') {
            try {
                const payload = await fetchMujahiSoftMistakes(fen, cfg, controller.signal);
                result = {
                    candidates: Array.isArray(payload?.candidates) ? payload.candidates : [],
                    reason: payload?.reason || 'ok',
                    sourceLabel: 'MUJAHI SF19'
                };
            } catch (apiErr) {
                if (apiErr?.name === 'AbortError' || controller.signal.aborted) return;
                if (['LICENSE_KEY_REQUIRED', 'INVALID_KEY', 'MOVES_EXHAUSTED'].includes(apiErr?.code)) {
                    handleMujahiError(apiErr);
                    throw apiErr;
                }
                // Fallback transparently to bundled Stockfish 19 Lite WASM if Render doesn't have the new route yet
                try {
                    result = await runLocalWasmSoftMistakesWithRetry(fen, cfg, controller.signal);
                } catch (wasmErr) {
                    if (wasmErr?.name === 'AbortError' || controller.signal.aborted) return;
                    throw wasmErr;
                }
            }
        } else if (provider === 'wasm') {
            result = await runLocalWasmSoftMistakesWithRetry(fen, cfg, controller.signal);
        } else {
            try {
                result = await runLocalWasmSoftMistakesWithRetry(fen, cfg, controller.signal);
            } catch (wasmErr) {
                if (wasmErr?.name === 'AbortError' || controller.signal.aborted) return;
                try {
                    const payload = await fetchMujahiSoftMistakes(fen, cfg, controller.signal);
                    result = {
                        candidates: Array.isArray(payload?.candidates) ? payload.candidates : [],
                        reason: payload?.reason || 'ok',
                        sourceLabel: 'MUJAHI SF19'
                    };
                } catch (apiErr) {
                    if (apiErr?.name === 'AbortError' || controller.signal.aborted) return;
                    // Preserve the clear Local WASM diagnostic when Hosted API fallback also lacks the route.
                    throw wasmErr;
                }
            }
        }

        if (controller.signal.aborted || getFEN() !== fen) return;
        const nextState = result.candidates.length
            ? { fen, loading: false, candidates: result.candidates, status: '', sourceLabel: result.sourceLabel }
            : { fen, loading: false, candidates: [], status: softMistakeReasonMessage(result.reason, cfg), sourceLabel: result.sourceLabel };

        setBoundedCache(softMistakesCache, cacheKey, nextState, 120);
        renderSoftMistakesState(nextState);
    } catch (err) {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        if (getFEN() === fen) {
            renderSoftMistakesState({
                fen,
                loading: false,
                candidates: [],
                status: err?.message || 'Scan failed — try again',
                sourceLabel: ''
            });
        }
    } finally {
        if (softMistakesController === controller) softMistakesController = null;
    }
}

async function fetchEngineBestMove(fen, depth, signal = null) {
    const provider = getEngineProvider();
    const cacheKey = `${provider}|${fen}|${depth}`;
    if (fenCache.has(cacheKey)) {
        const cachedAnalysis = engineAnalysisCache.get(fen);
        if (cachedAnalysis) handleSuperModeEngineAnalysis(fen, cachedAnalysis);
        return fenCache.get(cacheKey);
    }
    if (engineInFlight.has(cacheKey)) return engineInFlight.get(cacheKey);
    const request = (async () => {
        if (provider === 'wasm') {
            return await fetchLocalWasmBestMove(fen, depth, signal, cacheKey);
        }
        if (provider === 'mujahi') {
            const adapter = getMujahiProvider();
            if (!adapter) {
                return handleMujahiError(new Error('MUJAHI provider adapter failed to load. Reload the extension in chrome://extensions.'));
            }
            try {
                const move = await adapter.fetchBestMove(fen, depth, signal, (analysis) => {
                    hasShownMujahiError = false;
                    if (analysis?.quota) syncQuotaFromMujahi(analysis.quota);
                    const prior = engineAnalysisCache.get(fen);
                    if (!prior || analysis.depth >= (prior.depth || 0)) {
                        setBoundedCache(engineAnalysisCache, fen, analysis, 120);
                    }
                    handleSuperModeEngineAnalysis(fen, analysis);
                    if (analysis.move) {
                        setBoundedCache(fenCache, `mujahi|${fen}|${analysis.depth}`, analysis.move);
                    }
                });
                if (move) {
                    hasShownMujahiError = false;
                    setBoundedCache(fenCache, cacheKey, move);
                }
                return move;
            } catch (err) {
                if (err?.name === 'AbortError' || signal?.aborted) return null;
                return handleMujahiError(err);
            }
        }
        const url = `https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(fen)}&depth=${depth}`;
        const data = await fetchJsonWithRetry(url, signal ? { signal } : {}, `Stockfish API depth ${depth}`);
        if (data === false) return false;
        if (data?.success && data.bestmove) {
            const move = data.bestmove.split(' ')[1];
            if (move) {
                const rawEval = data.evaluation ?? data.eval ?? data.score;
                const evaluation = rawEval === null || rawEval === undefined || rawEval === '' ? null : Number(rawEval);
                const rawMate = data.mate;
                const mate = rawMate === null || rawMate === undefined || rawMate === '' || rawMate === 'null' ? null : Number(rawMate);
                const continuationStr = typeof data.continuation === 'string' ? data.continuation : '';
                const pvList = continuationStr.trim().split(/\s+/).filter(Boolean);
                const ponder = pvList[1] || (data.bestmove.split(' ')[3] || null);
                const analysis = {
                    move,
                    ponder: ponder && ponder !== '(none)' ? ponder : null,
                    evaluation: Number.isFinite(evaluation) ? evaluation : null,
                    rawCp: Number.isFinite(evaluation) ? Math.round(evaluation * 100) : null,
                    mate: Number.isFinite(mate) ? mate : null,
                    bound: 'exact',
                    pv: pvList,
                    continuation: continuationStr,
                    depth: Number(data.depth) || Number(depth) || 0,
                    version: 'Hosted Stockfish',
                    raw: data
                };
                setBoundedCache(fenCache, cacheKey, move);
                const prior = engineAnalysisCache.get(fen);
                if (!prior || analysis.depth >= prior.depth) {
                    setBoundedCache(engineAnalysisCache, fen, analysis, 120);
                }
                handleSuperModeEngineAnalysis(fen, analysis);
                return move;
            }
        }
        return null;
    })();
    engineInFlight.set(cacheKey, request);
    try { return await request; } finally { if (engineInFlight.get(cacheKey) === request) engineInFlight.delete(cacheKey); }
}

function resetLocalEngineRuntime({ terminate = true, error = localEngineAbortError() } = {}) {
    if (terminate && (localEnginePort || localEngineFrame)) {
        try { localEnginePost({ type: 'terminate' }); } catch (_) {}
    }
    if (localEngineHostTimer) { clearTimeout(localEngineHostTimer); localEngineHostTimer = null; }
    if (localEnginePortTimer) { clearTimeout(localEnginePortTimer); localEnginePortTimer = null; }
    if (localEngineHostReject) {
        const reject = localEngineHostReject;
        localEngineHostResolve = localEngineHostReject = null;
        reject(error);
    }
    if (localEngineActiveSearch) finishLocalWasmSearch(localEngineActiveSearch, null, error);
    for (const job of [...localEngineSearchQueue]) finishLocalWasmSearch(job, null, error);
    localEngineSearchQueue = [];
    localWasmSearches.clear();
    rejectLocalEngineLineWaiters(error);
    if (localEnginePort) {
        try { localEnginePort.disconnect(); } catch (_) {}
        localEnginePort = null;
    }
    localEngineFrame?.remove();
    localEngineFrame = null;
    localEngineHostReady = false;
    localEngineHostPromise = null;
    localEngineUciPromise = null;
    localEngineFailure = null;
}

function setEngineProvider(provider) {
    const next = normalizeEngineProvider(provider);
    if (getEngineProvider() === next) return next;
    if (activeAnalysisController) activeAnalysisController.abort();
    activeAnalysisController = new AbortController();
    mujahiProvider?.cancelAll();
    analysisGeneration++;
    activeAnalysisFen = '';
    lastProcessedFen = '';
    lastObservedFen = '';
    fenCache.clear();
    engineInFlight.clear();
    engineAnalysisCache.clear();
    superModeSnapshotsByFen.clear();
    if (window.chessHelper) window.chessHelper.engineProvider = next;
    localStorage.setItem('ch_engine_provider', next);
    if (next !== 'wasm') {
        resetLocalEngineRuntime({ terminate: true, error: localEngineAbortError() });
    } else if (next === 'wasm' && localEngineFailure) {
        resetLocalEngineRuntime({ terminate: false, error: localEngineAbortError() });
        hasShownLocalEngineError = false;
    }
    if (next === 'mujahi') {
        hasShownMujahiError = false;
        warmMujahiKey(null, true);
    }
    setTimeout(() => scheduleTurnCheck(), 0);
    const providerLabel = next === 'wasm'
        ? 'local Stockfish 19 WASM'
        : next === 'mujahi'
            ? 'MUJAHI Stockfish 19 API'
            : 'StockfishOnline API';
    log(`Engine provider changed to ${providerLabel}`);
    return next;
}

async function fetchDatabaseBestMove(fen, signal = null) {
    if (lichessFenCache.has(fen)) return lichessFenCache.get(fen);
    if (databaseInFlight.has(fen)) return databaseInFlight.get(fen);
    const request = (async () => {
        const url = `https://explorer.lichess.org/lichess?fen=${encodeURIComponent(fen)}&moves=1&topGames=0&recentGames=0`;
        const opts = { headers: { 'Accept': 'application/json', 'Origin': 'https://www.chess.com' } };
        if (signal) opts.signal = signal;
        const data = await fetchJsonWithRetry(url, opts, 'Lichess database');
        if (data === false) return false;
        if (data?.moves?.length) {
            const sorted = [...data.moves].sort((a,b)=>(b.white+b.draws+b.black)-(a.white+b.draws+b.black));
            const move = sorted[0]?.uci;
            if (move) { setBoundedCache(lichessFenCache, fen, move); return move; }
        }
        return null;
    })();
    databaseInFlight.set(fen, request);
    try { return await request; } finally { if (databaseInFlight.get(fen) === request) databaseInFlight.delete(fen); }
}

// --- SUPERMODE: CONFIGURABLE CHESS INTELLIGENCE ---
const SUPER_PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const SUPER_START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 };
let superModeAuxController = null;
let superModeAuxKey = '';
let superModeCurrentFen = '';
let superModeLatestAnalysis = null;
let superModeLastEval = null;
let superModeMoveQuality = '';
let superModeMoveEvent = null;
let superModeOpponentBestMove = null;
let superModeOpponentRequestFen = '';
let superModeSession = [];
let superModeSessionReview = '';
const superModeApiData = { alternatives: null, opening: null, tablebase: null };
let superModeBoardOverlay = null;
let superModeOverlayBoard = null;
let superModeOverlayRenderKey = '';

function getSuperModeConfig() {
    const cfg = window.chessHelper || {};
    const opts = cfg.superModeOptions || {};
    const pvPlies = Math.max(2, Math.min(5, Number.parseInt(opts.pvPlies, 10) || 3));
    const hudCorner = opts.hudCorner === 'bottom-left' ? 'bottom-left' : 'top-left';
    const hudCompact = Boolean(opts.hudCompact);
    return {
        enabled: !!cfg.superModeEnabled && cfg.masterToggle !== false,
        features: cfg.superModeFeatures || {},
        options: { pvPlies, hudCorner, hudCompact }
    };
}
function fmtMoveArrow(uci) {
    if (!uci || uci.length < 4) return String(uci || '');
    return `${uci.slice(0, 2)}→${uci.slice(2, 4)}${uci[4] ? `=${uci[4].toUpperCase()}` : ''}`;
}
function fmtCompactNum(n) {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(Math.round(n));
}
function computeWhiteWinPercent(analysis) {
    if (!analysis) return null;
    if (analysis.mate !== null && analysis.mate !== undefined && Number.isFinite(Number(analysis.mate))) {
        const m = Number(analysis.mate);
        if (m > 0) return 100;
        if (m < 0) return 0;
    }
    const cp = Number.isFinite(Number(analysis.rawCp))
        ? Number(analysis.rawCp)
        : Number.isFinite(Number(analysis.evaluation))
            ? Number(analysis.evaluation) * 100
            : null;
    if (cp === null || !Number.isFinite(cp)) return null;
    const clampedCp = Math.max(-4000, Math.min(4000, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clampedCp)) - 1);
}
function recordSuperModeDepthSnapshot(fen, analysis) {
    if (!fen || !analysis) return;
    let fenMap = superModeSnapshotsByFen.get(fen);
    if (!fenMap) {
        fenMap = new Map();
        superModeSnapshotsByFen.set(fen, fenMap);
        if (superModeSnapshotsByFen.size > 120) {
            superModeSnapshotsByFen.delete(superModeSnapshotsByFen.keys().next().value);
        }
    }
    if (Array.isArray(analysis.depthSnapshots)) {
        for (const snap of analysis.depthSnapshots) {
            if (snap && snap.depth > 0 && snap.move) fenMap.set(snap.depth, snap);
        }
    }
    if (analysis.depth > 0 && analysis.move) {
        fenMap.set(analysis.depth, analysis);
    }
}
function getConsensusSummary(fen) {
    const fenMap = superModeSnapshotsByFen.get(fen);
    if (!fenMap || fenMap.size < 2) return null;
    const ordered = Array.from(fenMap.values()).sort((a, b) => a.depth - b.depth);
    const shallow = ordered[0];
    const deep = ordered[ordered.length - 1];
    if (!shallow || !deep || deep.depth <= shallow.depth || !shallow.move || !deep.move) return null;
    const agreed = shallow.move === deep.move;
    const evalDelta = Number.isFinite(shallow.evaluation) && Number.isFinite(deep.evaluation)
        ? deep.evaluation - shallow.evaluation
        : null;
    return {
        agreed,
        shallowDepth: shallow.depth,
        shallowMove: shallow.move,
        deepDepth: deep.depth,
        deepMove: deep.move,
        evalDelta
    };
}
function fenToPieceBoard(fen) {
    const placement = (fen || '').split(' ')[0];
    const rows = placement.split('/');
    if (rows.length !== 8) return null;
    const board = Array(64).fill(null); // rank 1 starts at index 0
    for (let row = 0; row < 8; row++) {
        let file = 0;
        for (const ch of rows[row]) {
            if (/^[1-8]$/.test(ch)) { file += Number(ch); continue; }
            if (!/[pnbrqkPNBRQK]/.test(ch) || file > 7) return null;
            const rank = 7 - row;
            board[rank * 8 + file] = { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b', square: `${'abcdefgh'[file]}${rank + 1}` };
            file++;
        }
        if (file !== 8) return null;
    }
    return board;
}
function attackersOf(board, targetIndex, color) {
    const tf = targetIndex % 8, tr = Math.floor(targetIndex / 8), found = [];
    for (let i = 0; i < 64; i++) {
        const piece = board[i];
        if (!piece || piece.color !== color || i === targetIndex) continue;
        const ff = i % 8, fr = Math.floor(i / 8);
        const dx = tf - ff, dy = tr - fr, ax = Math.abs(dx), ay = Math.abs(dy);
        let attacks = false;
        if (piece.type === 'p') attacks = ax === 1 && dy === (color === 'w' ? 1 : -1);
        else if (piece.type === 'n') attacks = (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
        else if (piece.type === 'k') attacks = Math.max(ax, ay) === 1;
        else {
            const diagonal = ax === ay && ax > 0;
            const straight = (dx === 0) !== (dy === 0);
            const canLine = piece.type === 'q' ? (diagonal || straight) : piece.type === 'b' ? diagonal : piece.type === 'r' ? straight : false;
            if (canLine) {
                const sx = Math.sign(dx), sy = Math.sign(dy);
                let x = ff + sx, y = fr + sy, clear = true;
                while (x !== tf || y !== tr) {
                    if (board[y * 8 + x]) { clear = false; break; }
                    x += sx; y += sy;
                }
                attacks = clear;
            }
        }
        if (attacks) found.push(piece);
    }
    return found;
}
function summarizeSuperModePosition(fen) {
    const board = fenToPieceBoard(fen);
    if (!board) return null;
    const counts = { w: { p:0,n:0,b:0,r:0,q:0,k:0 }, b: { p:0,n:0,b:0,r:0,q:0,k:0 } };
    const material = { w:0, b:0 };
    for (const piece of board) if (piece) { counts[piece.color][piece.type]++; material[piece.color] += SUPER_PIECE_VALUES[piece.type]; }
    const captured = { w: {}, b: {}, wValue: 0, bValue: 0 };
    for (const color of ['w','b']) for (const type of Object.keys(SUPER_START_COUNTS)) {
        const missing = Math.max(0, SUPER_START_COUNTS[type] - counts[color][type]);
        captured[color][type] = missing;
        captured[color === 'w' ? 'wValue' : 'bValue'] += missing * SUPER_PIECE_VALUES[type];
    }
    const myColor = getMyColor();
    const enemyColor = myColor === 'w' ? 'b' : 'w';
    const attacked = [], hanging = [];
    for (let i = 0; i < 64; i++) {
        const piece = board[i];
        if (!piece || piece.color !== myColor || piece.type === 'k') continue;
        const attackers = attackersOf(board, i, enemyColor);
        if (!attackers.length) continue;
        const defenders = attackersOf(board, i, myColor);
        const entry = { square: piece.square, type: piece.type, value: SUPER_PIECE_VALUES[piece.type], attackers: attackers.length, defenders: defenders.length };
        attacked.push(entry);
        if (!defenders.length) hanging.push(entry);
    }
    const centerSquares = [3 + 3*8, 4 + 3*8, 3 + 4*8, 4 + 4*8];
    const centerControlledSquares = centerSquares.filter(i => attackersOf(board, i, myColor).length > 0).map(i => `${'abcdefgh'[i % 8]}${Math.floor(i / 8) + 1}`);
    const centerControl = centerControlledSquares.length;
    const originalMinorSquares = myColor === 'w' ? ['b1','g1','c1','f1'] : ['b8','g8','c8','f8'];
    let homeMinorCount = 0;
    for (const sq of originalMinorSquares) {
        const file = 'abcdefgh'.indexOf(sq[0]), rank = Number(sq[1]) - 1;
        const piece = board[rank * 8 + file];
        if (piece && piece.color === myColor && ['n','b'].includes(piece.type)) homeMinorCount++;
    }
    const remainingMinor = board.filter(piece => piece && piece.color === myColor && ['n','b'].includes(piece.type)).length;
    const developedMinor = Math.max(0, remainingMinor - homeMinorCount);
    return { board, counts, material, captured, attacked, hanging, centerControl, centerControlledSquares, developedMinor, myColor };
}
function fmtEval(value) { return `${value > 0 ? '+' : ''}${value.toFixed(2)}`; }
function detectLastMoveSquares(previousFen, currentFen) {
    const before = fenToPieceBoard(previousFen), after = fenToPieceBoard(currentFen);
    if (!before || !after) return null;
    const changed = [];
    for (let i = 0; i < 64; i++) {
        const a = before[i], b = after[i];
        if ((a?.color || '') !== (b?.color || '') || (a?.type || '') !== (b?.type || '')) changed.push(i);
    }
    const kingFrom = changed.find(i => before[i]?.type === 'k' && !after[i]);
    const kingTo = changed.find(i => after[i]?.type === 'k' && !before[i]);
    if (kingFrom !== undefined && kingTo !== undefined) return { from: before[kingFrom].square, to: after[kingTo].square, mover: before[kingFrom].color };
    const destinations = changed.filter(i => after[i] && (!before[i] || before[i].color !== after[i].color || before[i].type !== after[i].type));
    if (!destinations.length) return null;
    const toIndex = destinations[0];
    const mover = after[toIndex].color;
    const sources = changed.filter(i => before[i]?.color === mover && (!after[i] || after[i].color !== mover || after[i].type !== before[i].type));
    const fromIndex = sources.find(i => before[i]?.type === after[toIndex]?.type) ?? sources[0];
    if (fromIndex === undefined) return { from: null, to: after[toIndex].square, mover };
    return { from: before[fromIndex].square, to: after[toIndex].square, mover };
}
function addSuperArrowSvg(parent, uci, flipped, { className, markerId, fill }) {
    if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return;
    const from = superModeSquarePosition(uci.slice(0, 2), flipped);
    const to = superModeSquarePosition(uci.slice(2, 4), flipped);
    if (!from || !to) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add(className);
    const defs = document.createElementNS(svgNS, 'defs');
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerWidth', '5');
    marker.setAttribute('markerHeight', '5');
    marker.setAttribute('refX', '4');
    marker.setAttribute('refY', '2.5');
    marker.setAttribute('orient', 'auto');
    const tip = document.createElementNS(svgNS, 'path');
    tip.setAttribute('d', 'M0,0 L5,2.5 L0,5 Z');
    tip.setAttribute('fill', fill);
    marker.appendChild(tip);
    defs.appendChild(marker);
    svg.appendChild(defs);
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String((from.x + 0.5) * 12.5));
    line.setAttribute('y1', String((from.y + 0.5) * 12.5));
    line.setAttribute('x2', String((to.x + 0.5) * 12.5));
    line.setAttribute('y2', String((to.y + 0.5) * 12.5));
    line.setAttribute('marker-end', `url(#${markerId})`);
    svg.appendChild(line);
    parent.appendChild(svg);
}
function addSuperOpponentArrow(parent, uci, flipped) {
    addSuperArrowSvg(parent, uci, flipped, {
        className: 'ch-sm-opponent-arrow',
        markerId: 'ch-sm-opponent-arrowhead',
        fill: '#c084fc'
    });
}
function addSuperPonderArrow(parent, uci, flipped) {
    addSuperArrowSvg(parent, uci, flipped, {
        className: 'ch-sm-ponder-arrow',
        markerId: 'ch-sm-ponder-arrowhead',
        fill: '#f59e0b'
    });
}
function addSuperPvLineOverlay(parent, pvList, flipped, myTurn) {
    if (!Array.isArray(pvList) || pvList.length < 2) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('ch-sm-pv-svg');

    for (let idx = 1; idx < pvList.length; idx++) {
        const uci = pvList[idx];
        if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) continue;
        const from = superModeSquarePosition(uci.slice(0, 2), flipped);
        const to = superModeSquarePosition(uci.slice(2, 4), flipped);
        if (!from || !to) continue;
        const isMyStep = myTurn ? (idx % 2 === 0) : (idx % 2 === 1);
        const stroke = isMyStep ? 'rgba(56, 189, 248, 0.72)' : 'rgba(245, 158, 11, 0.72)';

        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', String((from.x + 0.5) * 12.5));
        line.setAttribute('y1', String((from.y + 0.5) * 12.5));
        line.setAttribute('x2', String((to.x + 0.5) * 12.5));
        line.setAttribute('y2', String((to.y + 0.5) * 12.5));
        line.setAttribute('stroke', stroke);
        svg.appendChild(line);

        const cell = document.createElement('div');
        cell.className = `ch-sm-board-cell ch-sm-pv-cell ${isMyStep ? 'is-my-ply' : 'is-opp-ply'}`;
        cell.style.left = `${to.x * 12.5}%`;
        cell.style.top = `${to.y * 12.5}%`;
        const badge = document.createElement('span');
        badge.className = 'ch-sm-pv-step';
        badge.textContent = String(idx + 1);
        cell.appendChild(badge);
        parent.appendChild(cell);
    }
    if (svg.childElementCount) parent.appendChild(svg);
}
function addSuperEvalSparkline(hud, sessionItems, myColor) {
    const scored = sessionItems.filter(item => Number.isFinite(item.evaluation) || Number.isFinite(item.mate)).slice(-24);
    if (scored.length < 2) return;
    const vals = scored.map(item => {
        if (item.mate !== null && item.mate !== undefined && Number.isFinite(item.mate)) {
            return item.mate > 0 ? 6 : -6;
        }
        return Math.max(-6, Math.min(6, Number(item.evaluation) || 0));
    });
    const wrap = document.createElement('div');
    wrap.className = 'ch-sm-hud-item ch-sm-hud-sparkline';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 22');
    svg.setAttribute('width', '96');
    svg.setAttribute('height', '20');

    const mid = document.createElementNS(svgNS, 'line');
    mid.setAttribute('x1', '0');
    mid.setAttribute('y1', '11');
    mid.setAttribute('x2', '100');
    mid.setAttribute('y2', '11');
    mid.setAttribute('stroke', 'rgba(255,255,255,0.18)');
    mid.setAttribute('stroke-width', '0.8');
    mid.setAttribute('stroke-dasharray', '2 2');
    svg.appendChild(mid);

    const points = vals.map((v, i) => {
        const x = (i / Math.max(1, vals.length - 1)) * 96 + 2;
        const y = 11 - (v / 6) * 9;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const lastVal = vals[vals.length - 1];
    const isGoodForMe = myColor === 'w' ? lastVal >= 0 : lastVal <= 0;
    const strokeColor = Math.abs(lastVal) < 0.35 ? '#93c5fd' : (isGoodForMe ? '#4ade80' : '#f87171');

    const poly = document.createElementNS(svgNS, 'polyline');
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', strokeColor);
    poly.setAttribute('stroke-width', '1.6');
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('points', points);
    svg.appendChild(poly);

    const lastCoords = points.split(' ').pop().split(',');
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', lastCoords[0]);
    dot.setAttribute('cy', lastCoords[1]);
    dot.setAttribute('r', '2');
    dot.setAttribute('fill', strokeColor);
    svg.appendChild(dot);

    wrap.appendChild(svg);
    hud.appendChild(wrap);
}
function superModeClearBoardOverlay() {
    if (superModeBoardOverlay?.isConnected) superModeBoardOverlay.remove();
    superModeBoardOverlay = null;
    superModeOverlayBoard = null;
    superModeOverlayRenderKey = '';
}
function superModeGetOverlay(board) {
    if (!board) return null;
    if (superModeOverlayBoard !== board || !superModeBoardOverlay?.isConnected) {
        superModeClearBoardOverlay();
        if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
        const overlay = document.createElement('div');
        overlay.className = 'ch-super-board-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        board.appendChild(overlay);
        superModeBoardOverlay = overlay;
        superModeOverlayBoard = board;
    }
    return superModeBoardOverlay;
}
function superModeSquarePosition(square, flipped) {
    const file = 'abcdefgh'.indexOf(square?.[0]);
    const rank = Number(square?.[1]);
    if (file < 0 || rank < 1 || rank > 8) return null;
    return { x: flipped ? 7 - file : file, y: flipped ? rank - 1 : 8 - rank };
}
function addSuperHud(parent, text, className = '') {
    if (!text) return;
    const item = document.createElement('span');
    item.className = `ch-sm-hud-item ${className}`.trim();
    item.textContent = text;
    parent.appendChild(item);
}
function addSuperSquareMark(parent, square, flipped, className, text = '') {
    const pos = superModeSquarePosition(square, flipped);
    if (!pos) return;
    const cell = document.createElement('div');
    cell.className = `ch-sm-board-cell ${className}`;
    cell.style.left = `${pos.x * 12.5}%`;
    cell.style.top = `${pos.y * 12.5}%`;
    if (text) {
        const mark = document.createElement('span');
        mark.className = 'ch-sm-square-mark';
        mark.textContent = text;
        cell.appendChild(mark);
    }
    parent.appendChild(cell);
}
function renderSuperModeBoard(fen = superModeCurrentFen) {
    const cfg = getSuperModeConfig();
    if (!cfg.enabled || !fen || !Object.values(cfg.features).some(Boolean)) {
        superModeClearBoardOverlay();
        return;
    }
    const boardEl = getBoard();
    if (!boardEl) return;
    const f = cfg.features;
    const opts = cfg.options;
    const flipped = boardEl.classList.contains('flipped');
    const activeAnalysis = superModeLatestAnalysis && superModeLatestAnalysis.fen === fen ? superModeLatestAnalysis : null;
    const displayedAnalysis = activeAnalysis || superModeLatestAnalysis;
    const moveEvent = superModeMoveEvent && superModeMoveEvent.fen === fen ? superModeMoveEvent : null;
    const opponentMove = superModeOpponentBestMove && superModeOpponentBestMove.fen === fen && (fen.split(' ')[1] || 'w') !== getMyColor() ? superModeOpponentBestMove : null;
    const consensus = f.depthConsensus ? getConsensusSummary(fen) : null;
    const pvList = activeAnalysis
        ? (Array.isArray(activeAnalysis.pv) && activeAnalysis.pv.length
            ? activeAnalysis.pv
            : (typeof activeAnalysis.continuation === 'string' ? activeAnalysis.continuation.trim().split(/\s+/).filter(Boolean) : []))
        : [];
    const renderKey = JSON.stringify({
        fen, flipped, features: f, options: opts,
        eval: displayedAnalysis ? [displayedAnalysis.evaluation, displayedAnalysis.rawCp, displayedAnalysis.mate, displayedAnalysis.depth, displayedAnalysis.nps, displayedAnalysis.time, displayedAnalysis.bound, displayedAnalysis.cached, displayedAnalysis.ponder, displayedAnalysis.continuation] : (superModeLastEval ? [superModeLastEval.evaluation, superModeLastEval.depth] : null),
        moveQuality: superModeMoveQuality,
        moveEvent, opponentMove: opponentMove?.move || '',
        consensus,
        pvSlice: f.pvLine ? pvList.slice(0, opts.pvPlies) : null,
        sessionLen: f.evalGraph ? superModeSession.length : 0,
        alternatives: superModeApiData.alternatives?.pvs?.[1]?.moves || superModeApiData.alternatives?.message || '',
        opening: superModeApiData.opening?.moves?.[0]?.uci || superModeApiData.opening?.message || '',
        tablebase: [superModeApiData.tablebase?.category, superModeApiData.tablebase?.dtz, superModeApiData.tablebase?.message],
        review: superModeSessionReview
    });
    if (superModeOverlayBoard === boardEl && superModeBoardOverlay?.isConnected && superModeOverlayRenderKey === renderKey) return;
    const local = summarizeSuperModePosition(fen);
    if (!local) return;
    const overlay = superModeGetOverlay(boardEl);
    if (!overlay) return;
    overlay.replaceChildren();
    superModeOverlayRenderKey = renderKey;
    const hud = document.createElement('div');
    hud.className = [
        'ch-sm-board-hud',
        opts.hudCorner === 'bottom-left' ? 'is-bottom-left' : '',
        opts.hudCompact ? 'is-compact' : ''
    ].filter(Boolean).join(' ');

    if (f.hanging) for (const piece of local.hanging) addSuperSquareMark(overlay, piece.square, flipped, 'is-hanging', '!');
    if (f.threats) {
        const already = new Set(f.hanging ? local.hanging.map(piece => piece.square) : []);
        for (const piece of local.attacked) if (!already.has(piece.square)) addSuperSquareMark(overlay, piece.square, flipped, 'is-attacked', '×');
    }
    if (f.activity) for (const square of local.centerControlledSquares) addSuperSquareMark(overlay, square, flipped, 'is-center', '');

    if (f.pvLine && activeAnalysis && pvList.length >= 2) {
        const slicedPv = pvList.slice(0, opts.pvPlies);
        const myTurnNow = (fen.split(' ')[1] || 'w') === local.myColor;
        addSuperPvLineOverlay(overlay, slicedPv, flipped, myTurnNow);
        addSuperHud(hud, `LINE ${slicedPv.join(' ')}`, 'is-pv');
    }

    if (f.ponderArrow && activeAnalysis) {
        const myTurnNow = (fen.split(' ')[1] || 'w') === local.myColor;
        const ponderUci = activeAnalysis.ponder || (pvList[1] || '');
        if (ponderUci && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(ponderUci)) {
            if (myTurnNow) {
                addSuperPonderArrow(overlay, ponderUci, flipped);
                addSuperHud(hud, `REPLY ${fmtMoveArrow(ponderUci)}`, 'is-ponder');
            } else if (!opponentMove) {
                addSuperPonderArrow(overlay, ponderUci, flipped);
                addSuperHud(hud, `NEXT ${fmtMoveArrow(ponderUci)}`, 'is-ponder');
            }
        }
    }

    if (f.material) {
        const diff = local.material[local.myColor] - local.material[local.myColor === 'w' ? 'b' : 'w'];
        if (diff !== 0) addSuperHud(hud, `${diff > 0 ? 'YOU' : 'OPP'} +${Math.abs(diff)} MATERIAL`, diff > 0 ? 'is-positive' : 'is-negative');
    }
    if (f.captured) {
        const w = local.captured.wValue, b = local.captured.bValue;
        if (w + b > 0) addSuperHud(hud, `LOST W${w} · B${b}`, 'is-muted');
    }
    if (f.evaluation) {
        // Keep the evaluation rail mounted while a new position is being analysed.
        // Retain the last known score instead of removing/recreating the bar between FENs.
        const evalSource = displayedAnalysis && Number.isFinite(displayedAnalysis.evaluation)
            ? displayedAnalysis
            : superModeLastEval;
        const evalValue = Number.isFinite(evalSource?.evaluation) ? evalSource.evaluation : null;
        addSuperHud(hud, evalValue === null ? 'EVAL —' : `EVAL ${fmtEval(evalValue)} · D${evalSource?.depth || '—'}`, 'is-eval');
        const whitePct = evalValue === null ? 50 : Math.max(4, Math.min(96, 50 + evalValue * 8));
        const track = document.createElement('div');
        track.className = 'ch-sm-eval-track';
        const fill = document.createElement('div');
        fill.className = 'ch-sm-eval-fill';
        fill.style.height = `${whitePct}%`;
        track.appendChild(fill);
        overlay.appendChild(track);
    }
    if (f.winChance) {
        const winSource = (displayedAnalysis && (Number.isFinite(displayedAnalysis.evaluation) || displayedAnalysis.mate !== null))
            ? displayedAnalysis
            : superModeLastEval;
        const whiteWin = computeWhiteWinPercent(winSource);
        if (whiteWin !== null) {
            const myWin = Math.round(local.myColor === 'w' ? whiteWin : 100 - whiteWin);
            addSuperHud(hud, `WIN ${myWin}%`, myWin >= 58 ? 'is-positive' : myWin <= 42 ? 'is-negative' : 'is-eval');
        }
    }
    if (f.mate) {
        const a = superModeLatestAnalysis;
        if (a && a.fen === fen && a.mate !== null) addSuperHud(hud, `MATE ${Math.abs(a.mate)}`, 'is-mate');
    }
    if (f.depthConsensus && consensus) {
        if (consensus.agreed) {
            addSuperHud(hud, `D${consensus.shallowDepth}=D${consensus.deepDepth} LOCKED · ${fmtMoveArrow(consensus.deepMove)}`, 'is-consensus-locked');
        } else {
            addSuperHud(hud, `TRAP SHIFT · D${consensus.shallowDepth} ${fmtMoveArrow(consensus.shallowMove)} → D${consensus.deepDepth} ${fmtMoveArrow(consensus.deepMove)}`, 'is-warning');
        }
    }
    if (f.moveQuality && superModeMoveQuality) {
        const qualityMatch = superModeMoveQuality.match(/^(Blunder|Mistake|Inaccuracy|Strong move) estimate · eval (loss|gain) ([0-9.]+)/i);
        const shortQuality = qualityMatch ? `${qualityMatch[1].toUpperCase()} · ${qualityMatch[2].toUpperCase()} ${qualityMatch[3]}` : (superModeMoveQuality.startsWith('Small evaluation change') ? `MOVE ${superModeMoveQuality.match(/[+-][0-9.]+/)?.[0] || 'UPDATED'}` : superModeMoveQuality);
        addSuperHud(hud, shortQuality, /blunder|mistake/i.test(shortQuality) ? 'is-warning' : '');
    }

    if (f.blunders && moveEvent?.kind === 'blunder') {
        const moverLabel = moveEvent.mover === getMyColor() ? 'YOUR BLUNDER' : 'OPPONENT BLUNDER';
        addSuperHud(hud, `${moverLabel} · −${moveEvent.loss.toFixed(2)}`, 'is-warning');
        if (moveEvent.from) addSuperSquareMark(overlay, moveEvent.from, flipped, 'is-blunder-from', '');
        if (moveEvent.to) addSuperSquareMark(overlay, moveEvent.to, flipped, 'is-blunder-to', '!');
    }
    if (f.evalDrop && moveEvent?.kind === 'drop') {
        const moverLabel = moveEvent.mover === getMyColor() ? 'YOUR MOVE' : 'OPP MOVE';
        // Deliberately text-only: evaluation drops do not draw an arrow or move line.
        addSuperHud(hud, `${moverLabel} · EVAL DROP −${moveEvent.loss.toFixed(2)}`, 'is-eval-drop');
    }
    if (f.opponentBestMove && opponentMove) {
        addSuperHud(hud, `OPPONENT BEST · ${opponentMove.move.slice(0,2)}→${opponentMove.move.slice(2,4)}`, 'is-opponent-best');
        addSuperOpponentArrow(overlay, opponentMove.move, flipped);
    }

    if (f.engineTelemetry && activeAnalysis) {
        const parts = [];
        const ver = String(activeAnalysis.version || '').includes('19') ? 'SF19' : 'ENG';
        parts.push(`${ver} D${activeAnalysis.depth || '—'}${activeAnalysis.seldepth ? `/${activeAnalysis.seldepth}` : ''}`);
        if (Number.isFinite(activeAnalysis.nps)) parts.push(`${fmtCompactNum(activeAnalysis.nps)} nps`);
        if (Number.isFinite(activeAnalysis.time)) parts.push(activeAnalysis.time >= 1000 ? `${(activeAnalysis.time / 1000).toFixed(1)}s` : `${activeAnalysis.time}ms`);
        if (activeAnalysis.cached) parts.push('CACHED');
        else if (activeAnalysis.deduplicated) parts.push('SHARED');
        if (activeAnalysis.bound === 'lowerbound') parts.push('LOWER');
        else if (activeAnalysis.bound === 'upperbound') parts.push('UPPER');
        if (activeAnalysis.terminal) parts.push('TERMINAL');
        addSuperHud(hud, parts.join(' · '), 'is-telemetry');
    }

    if (f.evalGraph) {
        addSuperEvalSparkline(hud, superModeSession, local.myColor);
    }

    if (f.alternatives) {
        const alt = superModeApiData.alternatives;
        const line = alt?.pvs?.[1]?.moves;
        if (line) addSuperHud(hud, `ALT ${line.split(' ').slice(0, 3).join(' ')}`, 'is-lookup');
    }
    if (f.openingExplorer) {
        const opening = superModeApiData.opening;
        const first = opening?.moves?.[0];
        if (first) {
            const games = (first.white || 0) + (first.draws || 0) + (first.black || 0);
            addSuperHud(hud, `BOOK ${first.san || first.uci || '?'} · ${games.toLocaleString()} games`, 'is-lookup');
        }
    }
    if (f.tablebase) {
        const tb = superModeApiData.tablebase;
        if (tb?.category) addSuperHud(hud, `TABLEBASE ${String(tb.category).toUpperCase()} · DTZ ${tb.dtz ?? '—'}`, 'is-lookup');
    }
    if (f.review && superModeSessionReview) addSuperHud(hud, superModeSessionReview, 'is-review');
    if (hud.childElementCount) overlay.appendChild(hud);
}
function updateSuperModeLocal(fen) {
    superModeCurrentFen = fen;
    const cfg = getSuperModeConfig();
    if (!cfg.enabled) { superModeClearBoardOverlay(); if (superModeAuxController) superModeAuxController.abort(); superModeAuxKey = ''; return; }
    renderSuperModeBoard(fen);
    // Run optional network lookups only on the user's turn to limit API traffic.
    if ((fen.split(' ')[1] || 'w') !== getMyColor()) {
        if (superModeAuxController) superModeAuxController.abort();
        superModeAuxController = null;
        superModeAuxKey = '';
        return;
    }
    loadSuperModeApis(fen);
}
function handleSuperModeEngineAnalysis(fen, analysis) {
    if (getFEN() !== fen) return;
    recordSuperModeDepthSnapshot(fen, analysis);

    // Keep a tiny in-memory evaluation trail from normal engine results. This adds no API calls
    // and allows Post-game review to be enabled after a game has started.
    const priorSessionIndex = superModeSession.findIndex(item => item.fen === fen);
    const sessionItem = {
        fen,
        evaluation: analysis.evaluation,
        rawCp: analysis.rawCp ?? null,
        mate: analysis.mate,
        depth: analysis.depth,
        at: Date.now()
    };
    if (priorSessionIndex >= 0) {
        if ((analysis.depth || 0) >= (superModeSession[priorSessionIndex].depth || 0)) superModeSession[priorSessionIndex] = sessionItem;
    } else {
        superModeSession.push(sessionItem);
        if (superModeSession.length > 120) superModeSession.shift();
    }
    const cfg = getSuperModeConfig();
    if (!cfg.enabled) return;

    const currentDepthOnFen = superModeLatestAnalysis?.fen === fen ? (superModeLatestAnalysis.depth || 0) : 0;
    if (analysis.evaluation !== null && Number.isFinite(analysis.evaluation)) {
        const previous = superModeLastEval;
        if (previous && previous.fen !== fen && Number.isFinite(previous.evaluation)) {
            const active = (fen.split(' ')[1] || 'w');
            const lastMover = active === 'w' ? 'b' : 'w';
            const gain = lastMover === 'w' ? analysis.evaluation - previous.evaluation : previous.evaluation - analysis.evaluation;
            const loss = -gain;
            const moveSquares = detectLastMoveSquares(previous.fen, fen);
            superModeMoveEvent = loss >= 0.35 ? {
                fen, kind: loss >= 1.5 ? 'blunder' : 'drop', loss, mover: moveSquares?.mover || lastMover,
                from: moveSquares?.from || null, to: moveSquares?.to || null
            } : null;
            if (loss >= 1.5) superModeMoveQuality = `Blunder estimate · eval loss ${loss.toFixed(2)}`;
            else if (loss >= 0.8) superModeMoveQuality = `Mistake estimate · eval loss ${loss.toFixed(2)}`;
            else if (loss >= 0.35) superModeMoveQuality = `Inaccuracy estimate · eval loss ${loss.toFixed(2)}`;
            else if (gain >= 0.35) superModeMoveQuality = `Strong move estimate · eval gain ${gain.toFixed(2)}`;
            else superModeMoveQuality = `Small evaluation change · ${gain >= 0 ? '+' : ''}${gain.toFixed(2)} from the last observed position`;
        }
        if ((analysis.depth || 0) >= currentDepthOnFen) {
            superModeLastEval = { fen, evaluation: analysis.evaluation, rawCp: analysis.rawCp ?? null, mate: analysis.mate ?? null, depth: analysis.depth };
        }
    }
    if ((analysis.depth || 0) >= currentDepthOnFen) {
        superModeLatestAnalysis = { ...analysis, fen };
    }
    renderSuperModeBoard(fen);
}
function requestSuperModeOpponentBestMove(fen) {
    const cfg = getSuperModeConfig();
    const features = cfg.features || {};
    const needsOpponentAnalysis = !!(
        features.opponentBestMove || features.evaluation || features.mate || features.moveQuality ||
        features.blunders || features.evalDrop || features.ponderArrow || features.pvLine ||
        features.depthConsensus || features.winChance || features.engineTelemetry || features.evalGraph
    );
    if (!cfg.enabled || !needsOpponentAnalysis || (fen.split(' ')[1] || 'w') === getMyColor()) return;
    if (superModeOpponentBestMove?.fen === fen || superModeOpponentRequestFen === fen) return;
    superModeOpponentRequestFen = fen;
    const controller = activeAnalysisController || (activeAnalysisController = new AbortController());
    const arrows = window.chessHelper?.arrows || {};
    const visibleDepths = ['d5','d10','d15'].filter(key => arrows[key]?.show).map(key => Number(arrows[key]?.depth) || 0);
    const fallbackDepth = Number(arrows.d10?.depth) || 10;
    const depth = Math.max(1, Math.min(20, Math.max(0, ...visibleDepths) || fallbackDepth));
    fetchEngineBestMove(fen, depth, controller.signal).then(move => {
        const currentFeatures = getSuperModeConfig().features || {};
        const stillNeeded = currentFeatures.opponentBestMove || currentFeatures.evaluation || currentFeatures.mate || currentFeatures.moveQuality || currentFeatures.blunders || currentFeatures.evalDrop || currentFeatures.ponderArrow || currentFeatures.pvLine || currentFeatures.depthConsensus || currentFeatures.winChance || currentFeatures.engineTelemetry || currentFeatures.evalGraph;
        if (!move || controller.signal.aborted || getFEN() !== fen || !stillNeeded) return;
        superModeOpponentBestMove = { fen, move, depth: engineAnalysisCache.get(fen)?.depth || depth };
        renderSuperModeBoard(fen);
    }).catch(error => {
        if (error?.name !== 'AbortError') console.warn('[ChessHelper] Opponent best-move analysis failed', error);
    }).finally(() => {
        if (superModeOpponentRequestFen === fen) superModeOpponentRequestFen = '';
    });
}
function countFenPieces(fen) { return (fen.split(' ')[0].match(/[pnbrqk]/gi) || []).length; }
async function loadSuperModeApis(fen) {
    const cfg = getSuperModeConfig(), f = cfg.features;
    if (!cfg.enabled) return;
    const wants = ['openingExplorer','alternatives','tablebase'].filter(key => f[key]);
    if (!wants.length) { if (superModeAuxController) superModeAuxController.abort(); superModeAuxController = null; superModeAuxKey = ''; return; }
    const key = `${fen}|${wants.join(',')}`;
    if (key === superModeAuxKey) return;
    if (superModeAuxController) superModeAuxController.abort();
    superModeAuxController = new AbortController();
    const signal = superModeAuxController.signal;
    superModeAuxKey = key;
    for (const feature of wants) {
        const target = feature === 'openingExplorer' ? 'opening' : feature === 'tablebase' ? 'tablebase' : 'alternatives';
        superModeApiData[target] = superModeAuxCache.has(`${feature}|${fen}`)
            ? superModeAuxCache.get(`${feature}|${fen}`)
            : { message: 'Loading…' };
    }
    renderSuperModeBoard(fen);
    const current = () => !signal.aborted && getFEN() === fen && getSuperModeConfig().enabled;
    const tasks = [];
    const lookupFen = getCloudLookupFens(fen)[0] || fen;
    if (f.openingExplorer && !superModeAuxCache.has(`openingExplorer|${fen}`)) tasks.push((async () => {
        const url = `https://explorer.lichess.org/lichess?fen=${encodeURIComponent(lookupFen)}&moves=5&topGames=0&recentGames=0`;
        const data = await fetchJsonWithRetry(url, { signal, headers: { 'Accept':'application/json' } }, 'SuperMode Opening Explorer');
        if (!current()) return;
        const value = data && data !== false ? data : { message: data === false ? 'API access denied or unavailable.' : 'No opening data found for this position.' };
        setBoundedCache(superModeAuxCache, `openingExplorer|${fen}`, value, 300); superModeApiData.opening = value; renderSuperModeBoard(fen);
    })());
    if (f.alternatives && !superModeAuxCache.has(`alternatives|${fen}`)) tasks.push((async () => {
        const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(lookupFen)}&multiPv=3`;
        const data = await fetchJsonWithRetry(url, { signal, headers: { 'Accept':'application/json' } }, 'SuperMode Alternative Lines');
        if (!current()) return;
        const value = data && data !== false && Array.isArray(data.pvs) ? data : { message: data === false ? 'Cloud evaluation unavailable or not cached.' : 'No cached alternative lines for this position.' };
        setBoundedCache(superModeAuxCache, `alternatives|${fen}`, value, 300); superModeApiData.alternatives = value; renderSuperModeBoard(fen);
    })());
    if (f.tablebase && !superModeAuxCache.has(`tablebase|${fen}`)) tasks.push((async () => {
        if (countFenPieces(fen) > 7) {
            const value = { message: 'Not eligible yet: tablebase supports positions with seven or fewer pieces.' };
            setBoundedCache(superModeAuxCache, `tablebase|${fen}`, value, 300); superModeApiData.tablebase = value; renderSuperModeBoard(fen); return;
        }
        const url = `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;
        const data = await fetchJsonWithRetry(url, { signal, headers: { 'Accept':'application/json' } }, 'SuperMode Endgame Tablebase');
        if (!current()) return;
        const value = data && data !== false ? data : { message: data === false ? 'Tablebase lookup unavailable.' : 'No tablebase result found.' };
        setBoundedCache(superModeAuxCache, `tablebase|${fen}`, value, 300); superModeApiData.tablebase = value; renderSuperModeBoard(fen);
    })());
    Promise.allSettled(tasks).then(() => { if (current()) renderSuperModeBoard(fen); });
}
function reviewSuperModeSession() {
    if (!superModeSession.length) { superModeSessionReview = 'No engine-evaluated positions have been recorded yet.'; renderSuperModeBoard(superModeCurrentFen); return; }
    const scored = superModeSession.filter(x => Number.isFinite(x.evaluation));
    if (scored.length < 2) { superModeSessionReview = `${superModeSession.length} positions recorded, but at least two evaluations are needed for a review.`; renderSuperModeBoard(superModeCurrentFen); return; }
    let largest = { swing: 0, from: null, to: null };
    let totalCpLoss = 0;
    let transitions = 0;
    let mistakes = 0;
    let blunders = 0;
    for (let i = 1; i < scored.length; i++) {
        const swing = Math.abs(scored[i].evaluation - scored[i-1].evaluation);
        if (swing > largest.swing) largest = { swing, from: scored[i-1], to: scored[i] };
        const prevTurn = (scored[i-1].fen.split(' ')[1] || 'w');
        const moverLoss = prevTurn === 'w'
            ? (scored[i-1].evaluation - scored[i].evaluation)
            : (scored[i].evaluation - scored[i-1].evaluation);
        const clampedLossCp = Math.max(0, Math.round(moverLoss * 100));
        totalCpLoss += Math.min(1000, clampedLossCp);
        transitions++;
        if (moverLoss >= 1.5) blunders++;
        else if (moverLoss >= 0.8) mistakes++;
    }
    const acpl = transitions ? Math.round(totalCpLoss / transitions) : 0;
    superModeSessionReview = `${scored.length} pos · ACPL ${acpl} · ${blunders} blunders / ${mistakes} mistakes · Max swing ${largest.swing.toFixed(2)} (${fmtEval(largest.from.evaluation)} → ${fmtEval(largest.to.evaluation)})`;
    renderSuperModeBoard(superModeCurrentFen);
}
function refreshSuperMode() {
    const cfg = getSuperModeConfig();
    if (!cfg.enabled) {
        superModeClearBoardOverlay();
        if (superModeAuxController) superModeAuxController.abort();
        superModeAuxController = null; superModeAuxKey = '';
    } else {
        superModeAuxKey = '';
        const fen = getFEN();
        if (fen) {
            updateSuperModeLocal(fen);
            const cached = engineAnalysisCache.get(fen);
            if (cached) handleSuperModeEngineAnalysis(fen, cached);
            const features = cfg.features || {};
            const needsOpponentAnalysis = features.opponentBestMove || features.evaluation || features.mate || features.moveQuality || features.blunders || features.evalDrop || features.ponderArrow || features.pvLine || features.depthConsensus || features.winChance || features.engineTelemetry || features.evalGraph;
            if (needsOpponentAnalysis && (fen.split(' ')[1] || 'w') !== getMyColor() && window.chessHelper?.useEngine !== false) requestSuperModeOpponentBestMove(fen);
            else if (needsOpponentAnalysis && (fen.split(' ')[1] || 'w') === getMyColor() && !cached && window.chessHelper?.useEngine !== false) {
                lastProcessedFen = '';
                scheduleTurnCheck();
            }
        }
    }
    renderSuperModeBoard(superModeCurrentFen);
}

// --- MOVE EXECUTION ---
function dispatchPointer(type, elem, coords) { elem.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, view: window, clientX: coords.x, clientY: coords.y, buttons: 1, pointerId: 1, isPrimary: true, width: 1, height: 1, pressure: 0.5 })); }

async function makeMove(move) {
    if (!move) return;
    const board = getBoard();
    if (!board) return;
    const fromSq = move.substring(0, 2);
    if (!isMyPieceOnSquare(fromSq)) return;
    const toSq = move.substring(2, 4);
    const isPromotion = move.length === 5;
    const promotionPiece = isPromotion ? move[4] : null;
    const fromRect = getSquareRect(fromSq);
    const toRect = getSquareRect(toSq);
    if (!fromRect || !toRect) return;
    const startCoords = { x: fromRect.centerX, y: fromRect.centerY };
    const endCoords = { x: toRect.centerX, y: toRect.centerY };
    const hitEl = document.elementFromPoint(startCoords.x, startCoords.y);
    const targetEl = (hitEl && !hitEl.closest?.('#chess-helper-root'))
        ? hitEl
        : (getPieceElementOnSquare(fromSq) || board);
    dispatchPointer('pointerdown', targetEl, startCoords);
    await sleep(20);
    dispatchPointer('pointermove', document.body, endCoords);
    await sleep(20);
    dispatchPointer('pointerup', document.body, endCoords);
    if (isPromotion) await handlePromotion(promotionPiece);
}

async function handlePromotion(piece) { const deadline = Date.now() + 2500; let promotionWindow = null; while (Date.now() < deadline) { promotionWindow = document.querySelector('.promotion-window'); if (promotionWindow) break; await sleep(50); } if (!promotionWindow) return; await sleep(80); const p = piece.toLowerCase(); const myColor = getMyColor(); const candidates = [`.promotion-piece.${myColor}${p}`, `.promotion-piece.w${p}`, `.promotion-piece.b${p}`, `.promotion-window .promotion-piece.${myColor}${p}`, `.promotion-window .promotion-piece.w${p}`, `.promotion-window .promotion-piece.b${p}`]; const allPromo = promotionWindow.querySelectorAll('.promotion-piece'); let btn = null; for (const sel of candidates) { btn = document.querySelector(sel); if (btn) break; } if (!btn) { const order = { 'b': 0, 'n': 1, 'q': 2, 'r': 3 }; btn = allPromo[order[p] ?? 2] || null; } if (!btn) return; btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); btn.click(); }

// --- LOOP & LOGIC ---
let lastProcessedFen = "";
let activeAnalysisFen = "";
let retryTimer = null;
let analysisGeneration = 0;
let autoPlayEpoch = 0;
let checkmateShown = false;

function checkForGameEnd() {
    const gameOverModal = document.querySelector('.game-over-modal, .board-dialog-component, .game-result');
    if (gameOverModal && !checkmateShown) {
        checkmateShown = true;
        clearFenCache();
        const isPremium = localStorage.getItem('ch_is_premium') === 'true';
        if (!isPremium && window.showCustomModal) {
            window.showCustomModal("Game Over! 🎯", "Great match! Did you know Premium users get Human Style AI and unlimited moves? Dominate the board.", "View Premium", () => {
                window.open('https://xndroid.store', '_blank');
            });
        }
    }
    if (!gameOverModal && checkmateShown) checkmateShown = false;
}

let turnCheckTimeout = null;
let scheduledFrame = 0;
let observer = null;
let observedBoard = null;
let watchdogInterval = null;
let lastObservedFen = '';
let lastUsageRecordedFen = '';
let extensionMutationPending = false;

function scheduleTurnCheck() {
    if (document.hidden || !window.chessHelper?.masterToggle) return;
    if (scheduledFrame) return;
    scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = 0;
        if (turnCheckTimeout) clearTimeout(turnCheckTimeout);
        turnCheckTimeout = setTimeout(() => { turnCheckTimeout = null; checkTurnAndPlay(); }, 90);
    });
}
function isExtensionMutation(record) {
    const nodes = [...record.addedNodes, ...record.removedNodes];
    if (nodes.length && nodes.every(node => node.nodeType === 1 && (node.matches?.('.ch-arrow-svg, .ch-highlight, .ch-super-board-overlay, #chess-helper-root') || node.closest?.('#chess-helper-root, .ch-super-board-overlay')))) return true;
    return record.target?.closest?.('#chess-helper-root, .ch-arrow-svg, .ch-highlight, .ch-super-board-overlay') || false;
}
function attachBoardObserver() {
    const board = getBoard();
    if (!board) { setTimeout(attachBoardObserver, 1200); return; }
    if (observer) observer.disconnect();
    observedBoard = board;
    observer = new MutationObserver(records => {
        if (document.hidden) return;
        let relevant = false;
        for (const record of records) {
            if (isExtensionMutation(record)) continue;
            if (record.type === 'childList') {
                const changed = [...record.addedNodes, ...record.removedNodes];
                if (!changed.length || changed.some(n => n.nodeType === 1 && (n.matches?.('.piece, .highlight') || n.querySelector?.('.piece, .highlight')))) relevant = true;
            } else if (record.type === 'attributes' && (record.attributeName === 'class' || record.attributeName === 'style')) relevant = true;
            if (relevant) break;
        }
        if (relevant) scheduleTurnCheck();
    });
    observer.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

async function checkTurnAndPlay() {
    if (document.hidden) return;
    if (window.chessHelper && window.chessHelper.masterToggle === false) {
        if (activeAnalysisController) activeAnalysisController.abort();
        if (softMistakesController) softMistakesController.abort();
        softMistakesController = null;
        mujahiProvider?.cancelAll();
        lastObservedFen = '';
        activeAnalysisFen = '';
        if (window.clearAllArrows) window.clearAllArrows();
        refreshSoftMistakesCard();
        return;
    }
    checkForGameEnd();
    const fen = getFEN();
    if (!fen) return;
    updateSuperModeLocal(fen);
    syncSoftMistakesForFen(fen);

    // Always read the current FEN, even while older requests are still running.
    if (fen !== lastObservedFen) {
        lastObservedFen = fen;
        if (activeAnalysisController) activeAnalysisController.abort();
        activeAnalysisController = new AbortController();
        mujahiProvider?.setActivePosition(fen);
        activeAnalysisFen = '';
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    }

    const activeColor = fen.split(' ')[1], myColor = getMyColor();
    if (activeColor !== myColor) {
        lastProcessedFen = '';
        activeAnalysisFen = '';
        if (window.clearAllArrows) window.clearAllArrows();
        const turnCfg = window.chessHelper || {};
        const turnFeatures = turnCfg.superModeFeatures || {};
        const needsOpponentAnalysis = turnFeatures.opponentBestMove || turnFeatures.evaluation || turnFeatures.mate || turnFeatures.moveQuality || turnFeatures.blunders || turnFeatures.evalDrop || turnFeatures.ponderArrow || turnFeatures.pvLine || turnFeatures.depthConsensus || turnFeatures.winChance || turnFeatures.engineTelemetry || turnFeatures.evalGraph;
        if (turnCfg.superModeEnabled && needsOpponentAnalysis && turnCfg.useEngine !== false) requestSuperModeOpponentBestMove(fen);
        return;
    }
    if (fen === lastProcessedFen || fen === activeAnalysisFen) return;
    if (lastUsageRecordedFen !== fen && !checkFreemiumLimit()) return;

    const cfg = window.chessHelper || {};
    const arrows = cfg.arrows || {};
    const engineEnabled = cfg.useEngine !== false;
    const engineKeys = engineEnabled ? ['d5','d10','d15'].filter(key => arrows[key]?.show) : [];
    const superFeatures = cfg.superModeFeatures || {};
    const superNeedsEngineEval = !!cfg.superModeEnabled && !!(
        superFeatures.evaluation || superFeatures.mate || superFeatures.moveQuality ||
        superFeatures.blunders || superFeatures.evalDrop || superFeatures.ponderArrow ||
        superFeatures.pvLine || superFeatures.depthConsensus || superFeatures.winChance ||
        superFeatures.engineTelemetry || superFeatures.evalGraph
    );
    const addSuperEvalJob = engineEnabled && superNeedsEngineEval && engineKeys.length === 0;
    if (!engineKeys.length && !addSuperEvalJob) return;

    const controller = activeAnalysisController || (activeAnalysisController = new AbortController());
    const generation = ++analysisGeneration;
    activeAnalysisFen = fen;
    let autoplayKey = null;
    if (cfg.autoPlay) {
        const autoplaySource = cfg.autoplayArrow || 'd15';
        if (autoplaySource === 'random-blue-teal') {
            // Randomly choose from the Blue (D5) and Teal (D10) arrows that are enabled.
            // If only one is enabled, use that one; if neither is enabled, do not auto-play.
            const availableRandomSources = ['d5', 'd10'].filter(key => engineKeys.includes(key));
            if (availableRandomSources.length) {
                autoplayKey = availableRandomSources[randomIntInclusive(0, availableRandomSources.length - 1)];
            }
        } else if (['d5', 'd10', 'd15'].includes(autoplaySource)) {
            autoplayKey = autoplaySource;
        } else {
            autoplayKey = 'd15';
        }
    }
    const autoplayEpochAtStart = autoPlayEpoch;
    if (window.clearAllArrows) window.clearAllArrows();
    if (lastUsageRecordedFen !== fen) {
        lastUsageRecordedFen = fen;
        recordMoveUsage();
    }

    // Launch each enabled source independently. A slow depth never blocks a newer FEN.
    const jobs = engineKeys.map(key => ({ key, run: () => fetchEngineBestMove(fen, arrows[key].depth, controller.signal) }));
    if (addSuperEvalJob) jobs.push({ key: 'superEval', run: () => fetchEngineBestMove(fen, arrows.d10?.depth || 10, controller.signal) });

    // On MUJAHI API, if depthConsensus is enabled without a shallow depth arrow, request D5 in the same batched search at zero extra search cost
    if (engineEnabled && cfg.superModeEnabled && superFeatures.depthConsensus && getEngineProvider() === 'mujahi') {
        const hasShallow = jobs.some(j => j.key !== 'superEval' && Number(arrows[j.key]?.depth) <= 7);
        const hasDeep = jobs.some(j => j.key === 'superEval' ? (arrows.d10?.depth || 10) >= 8 : Number(arrows[j.key]?.depth) >= 8);
        if (!hasShallow && jobs.length) {
            jobs.push({ key: 'superConsensus', run: () => fetchEngineBestMove(fen, 5, controller.signal) });
        }
        if (!hasDeep && jobs.length) {
            jobs.push({ key: 'superConsensusDeep', run: () => fetchEngineBestMove(fen, arrows.d15?.depth || 15, controller.signal) });
        }
    }

    let remaining = jobs.length;
    let anyFailed = false;
    let autoPlayed = false;

    const finishJob = () => {
        remaining--;
        if (remaining !== 0) return;
        if (generation !== analysisGeneration || controller.signal.aborted || document.hidden || getFEN() !== fen) return;
        activeAnalysisFen = '';
        if (!anyFailed) {
            // If auto-play was enabled/disabled while analysis was running, refresh this
            // position once so the current auto-play preference is honoured.
            if (window.chessHelper?.autoPlay && autoplayEpochAtStart !== autoPlayEpoch) {
                lastProcessedFen = '';
                scheduleTurnCheck();
            } else {
                lastProcessedFen = fen;
            }
        } else if (getEngineProvider() === 'wasm' && localEngineFailure) {
            // A missing/broken local build is a persistent setup error, not a transient
            // network failure. Avoid retrying every 900 ms until the user changes mode.
            lastProcessedFen = fen;
        } else {
            // Transient hosted API failures remain eligible for a short retry.
            lastProcessedFen = '';
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
                retryTimer = null;
                if (!document.hidden && getFEN() === fen) scheduleTurnCheck();
            }, 900);
        }
    };

    for (const job of jobs) {
        job.run().then(async move => {
            if (!move) { if (move !== false) anyFailed = true; return; }
            if (generation !== analysisGeneration || controller.signal.aborted || document.hidden || getFEN() !== fen) return;
            const arrowCfg = (window.chessHelper?.arrows || {})[job.key];
            if (!arrowCfg?.show || window.chessHelper?.useEngine === false) return;
            if (window.drawArrow) window.drawArrow(job.key, move);
            if (autoplayKey === job.key && !autoPlayed && window.chessHelper?.autoPlay) {
                autoPlayed = true;
                const randomizer = window.chessHelper?.autoplayRandomizer || {};
                const minDelay = Math.max(0, Math.min(10000, Number.isFinite(Number(randomizer.minMs)) ? Math.floor(Number(randomizer.minMs)) : 350));
                const maxDelay = Math.max(minDelay, Math.min(10000, Number.isFinite(Number(randomizer.maxMs)) ? Math.floor(Number(randomizer.maxMs)) : 1400));
                const delayMs = randomizer.enabled ? randomIntInclusive(minDelay, maxDelay) : 0;
                const delayCompleted = await waitForAutoPlayDelay(delayMs, controller.signal);
                const currentConfig = window.chessHelper || {};
                if (!delayCompleted || generation !== analysisGeneration || controller.signal.aborted || document.hidden || getFEN() !== fen || !currentConfig.autoPlay || currentConfig.masterToggle === false || autoplayEpochAtStart !== autoPlayEpoch) return;
                await makeMove(move);
            }
        }).catch(e => {
            if (e?.name !== 'AbortError') console.error('[ChessEngine] Analysis task failed', e);
            anyFailed = true;
        }).finally(finishJob);
    }
}

function onVisibilityChange() {
    document.documentElement.classList.toggle('chess-helper-tab-hidden', document.hidden);
    if (document.hidden) {
        if (turnCheckTimeout) { clearTimeout(turnCheckTimeout); turnCheckTimeout = null; }
        if (scheduledFrame) { cancelAnimationFrame(scheduledFrame); scheduledFrame = 0; }
        if (activeAnalysisController) activeAnalysisController.abort();
        if (softMistakesController) softMistakesController.abort();
        softMistakesController = null;
        mujahiProvider?.cancelAll();
        analysisGeneration++;
        activeAnalysisFen = '';
        lastProcessedFen = '';
        lastObservedFen = '';
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    } else { scheduleTurnCheck(); }
}
document.addEventListener('visibilitychange', onVisibilityChange);
attachBoardObserver();
// Low-frequency recovery check handles Chess.com board replacement without polling every 2 seconds.
watchdogInterval = setInterval(() => { if (document.hidden) return; const board = getBoard(); if (board && board !== observedBoard) attachBoardObserver(); scheduleTurnCheck(); }, 5000);

window.chessHelperEngine = {
    triggerAutoPlay: () => { lastProcessedFen = ""; scheduleTurnCheck(); },
    setAutoPlay: enabled => {
        autoPlayEpoch++;
        window.chessHelper.autoPlay = !!enabled;
        if (!enabled && pendingAutoPlayDelayCancel) pendingAutoPlayDelayCancel();
        if (enabled) { lastProcessedFen = ''; scheduleTurnCheck(); }
    },
    updateMoveUI: updateMoveUI,
    getFEN: getFEN,
    fetchEngineBestMove: fetchEngineBestMove,
    fetchDatabaseBestMove: fetchDatabaseBestMove,
    setEngineProvider: setEngineProvider,
    getEngineProvider: getEngineProvider,
    testMujahiHealth: testMujahiHealth,
    warmMujahiKey: warmMujahiKey,
    getMyColor: getMyColor,
    refreshSuperMode: refreshSuperMode,
    findSoftMistakes: findSoftMistakes,
    clearSoftMistakes: clearSoftMistakes,
    refreshSoftMistakesCard: refreshSoftMistakesCard,
    reviewSuperModeSession: reviewSuperModeSession,
    getSuperModeSession: () => superModeSession.slice()
};
