(() => {
    'use strict';
    const CHANNEL = 'chess-helper-local-stockfish-v1';
    const ALLOWED_PARENT_ORIGIN = 'https://www.chess.com';
    const ENGINE_URL = chrome.runtime.getURL('engine/stockfish-19-lite-single.js');
    const WASM_URL = chrome.runtime.getURL('engine/stockfish-19-lite-single.wasm');
    const UCI_COMMAND_RE = /^(uci|isready|ucinewgame|stop|quit|position (?:fen .+|startpos(?: moves .*)?)|go (?:depth|movetime) \d+(?: searchmoves(?: [a-h][1-8][a-h][1-8][qrbn]?)+)?|setoption name [A-Za-z0-9 _]+ value \d+)$/;
    const IS_IFRAME = (() => {
        try { return Boolean(window.parent && window.parent !== window); } catch (_) { return true; }
    })();

    let worker = null;
    let failed = false;
    let lastFailureMessage = '';
    let hostState = 'starting'; // 'starting' | 'ready' | 'error' | 'terminated'
    let startupGeneration = 0;
    let runtimePort = null;

    function notify(type, extra = {}) {
        const payload = { channel: CHANNEL, type, ...extra };
        if (IS_IFRAME) {
            window.parent.postMessage(payload, '*');
            return;
        }
        if (runtimePort) {
            try { runtimePort.postMessage(payload); } catch (_) {}
        }
    }

    function fail(error) {
        failed = true;
        hostState = 'error';
        const message = error?.message || String(error || 'Unknown Stockfish worker error');
        lastFailureMessage = message;
        notify('error', { message });
    }

    function formatWorkerError(event) {
        const detailParts = [];
        const rawMsg = event?.message || event?.error?.message || '';
        if (rawMsg) detailParts.push(rawMsg);
        if (event?.filename) {
            const fileName = String(event.filename).split('/').pop();
            const loc = Number.isFinite(event.lineno) && event.lineno > 0 ? `${fileName}:${event.lineno}` : fileName;
            if (loc && !rawMsg.includes(loc)) detailParts.push(`(${loc})`);
        }
        if (detailParts.length) {
            return `Stockfish WASM worker error: ${detailParts.join(' ')}`;
        }
        return 'Unable to load Stockfish WASM worker. Check that stockfish-19-lite-single.js (~28 KB) and stockfish-19-lite-single.wasm (~1.8 MB) are installed together in extension/engine/ and reload the extension.';
    }

    async function verifyEngineAssets() {
        let jsRes;
        try {
            jsRes = await fetch(ENGINE_URL, { cache: 'no-store' });
        } catch (err) {
            throw new Error(`Could not read engine/stockfish-19-lite-single.js (${err?.message || 'fetch failed'}). Reload the extension in chrome://extensions.`);
        }
        if (!jsRes.ok) {
            throw new Error(`Missing engine/stockfish-19-lite-single.js (HTTP ${jsRes.status}).`);
        }
        const jsBuf = await jsRes.arrayBuffer();
        const jsHead = new TextDecoder().decode(jsBuf.slice(0, 160)).trimStart();
        if (jsBuf.byteLength < 5000 || jsHead.startsWith('// Placeholder')) {
            throw new Error(`engine/stockfish-19-lite-single.js is only ${jsBuf.byteLength} bytes (placeholder, expected ~28,230 bytes). Replace it with the upstream release file and reload the extension.`);
        }
        if (jsHead.startsWith('<')) {
            throw new Error('engine/stockfish-19-lite-single.js contains HTML instead of JavaScript (check your download).');
        }

        let wasmRes;
        try {
            wasmRes = await fetch(WASM_URL, { cache: 'no-store' });
        } catch (err) {
            throw new Error(`Could not read engine/stockfish-19-lite-single.wasm (${err?.message || 'fetch failed'}).`);
        }
        if (!wasmRes.ok) {
            throw new Error(`Missing engine/stockfish-19-lite-single.wasm (HTTP ${wasmRes.status}).`);
        }
        const wasmBuf = await wasmRes.arrayBuffer();
        if (wasmBuf.byteLength < 50000) {
            throw new Error(`engine/stockfish-19-lite-single.wasm is only ${wasmBuf.byteLength} bytes (placeholder or incomplete, expected ~1,845,971 bytes).`);
        }
        const magic = new Uint8Array(wasmBuf.slice(0, 4));
        if (magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
            throw new Error('engine/stockfish-19-lite-single.wasm is not a valid WebAssembly binary (missing \\0asm header).');
        }
    }

    function stopCurrentWorker() {
        try { worker?.terminate(); } catch (_) {}
        worker = null;
    }

    async function startWorker() {
        const gen = ++startupGeneration;
        stopCurrentWorker();
        failed = false;
        lastFailureMessage = '';
        hostState = 'starting';
        try {
            await verifyEngineAssets();
            if (gen !== startupGeneration) return;

            const nextWorker = new Worker(ENGINE_URL);
            worker = nextWorker;
            nextWorker.onmessage = event => {
                if (worker !== nextWorker || gen !== startupGeneration) return;
                const line = typeof event.data === 'string' ? event.data : String(event.data ?? '');
                if (line) notify('line', { line });
            };
            nextWorker.onerror = event => {
                if (worker !== nextWorker || gen !== startupGeneration) return;
                event?.preventDefault?.();
                fail(new Error(formatWorkerError(event)));
            };
            nextWorker.onmessageerror = () => {
                if (worker !== nextWorker || gen !== startupGeneration) return;
                fail(new Error('Could not decode a message from the Stockfish worker.'));
            };
            hostState = 'ready';
            notify('ready');
        } catch (error) {
            if (gen !== startupGeneration) return;
            fail(error);
        }
    }

    function handleIncomingData(data) {
        if (!data || data.channel !== CHANNEL) return;
        if (data.type === 'command') {
            if (failed || !worker) {
                notify('error', {
                    message: lastFailureMessage || 'Stockfish worker is not running. Check engine/stockfish-19-lite-single.js and its matching .wasm file.'
                });
                return;
            }
            const command = String(data.command || '').trim();
            if (!UCI_COMMAND_RE.test(command)) return;
            worker.postMessage(command);
        } else if (data.type === 'restart') {
            startWorker();
        } else if (data.type === 'terminate') {
            startupGeneration++;
            stopCurrentWorker();
            failed = false;
            lastFailureMessage = '';
            hostState = 'terminated';
            notify('terminated');
        }
    }

    if (IS_IFRAME) {
        window.addEventListener('message', event => {
            if (event.source !== window.parent || event.origin !== ALLOWED_PARENT_ORIGIN) return;
            handleIncomingData(event.data);
        });
    } else if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
        const connectRuntimeHost = () => {
            try {
                const port = chrome.runtime.connect({ name: 'local-stockfish-host' });
                runtimePort = port;
                port.onMessage.addListener(handleIncomingData);
                port.onDisconnect.addListener(() => {
                    if (runtimePort === port) runtimePort = null;
                });
                if (hostState === 'ready') notify('ready');
                else if (hostState === 'error' && lastFailureMessage) notify('error', { message: lastFailureMessage });
            } catch (_) {
                runtimePort = null;
            }
        };
        connectRuntimeHost();
    }

    startWorker();
})();
