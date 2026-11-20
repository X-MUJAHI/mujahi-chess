(() => {
    'use strict';
    const CHANNEL = 'chess-helper-local-stockfish-v1';
    const ALLOWED_PARENT_ORIGIN = 'https://www.chess.com';
    const ENGINE_URL = chrome.runtime.getURL('engine/stockfish-19-lite-single.js');
    let worker = null;
    let failed = false;

    function notify(type, extra = {}) {
        window.parent.postMessage({ channel: CHANNEL, type, ...extra }, '*');
    }

    function fail(error) {
        failed = true;
        const message = error?.message || String(error || 'Unknown Stockfish worker error');
        notify('error', { message });
    }

    function startWorker() {
        try {
            // This extension-origin page is the same origin as the packaged worker,
            // unlike the Chess.com content script that embeds this host.
            worker = new Worker(ENGINE_URL);
            worker.onmessage = event => {
                const line = typeof event.data === 'string' ? event.data : String(event.data ?? '');
                if (line) notify('line', { line });
            };
            worker.onerror = event => {
                fail(new Error(event.message || 'Unable to load Stockfish WASM worker. Check that the JS and WASM files are installed together.'));
                event.preventDefault?.();
            };
            worker.onmessageerror = () => fail(new Error('Could not decode a message from the Stockfish worker.'));
            notify('ready');
        } catch (error) {
            fail(error);
        }
    }

    window.addEventListener('message', event => {
        if (event.source !== window.parent || event.origin !== ALLOWED_PARENT_ORIGIN) return;
        const data = event.data;
        if (!data || data.channel !== CHANNEL) return;
        if (data.type === 'command') {
            if (failed || !worker) {
                notify('error', { message: 'Stockfish worker is not running. Check engine/stockfish-19-lite-single.js and its matching .wasm file.' });
                return;
            }
            const command = String(data.command || '').trim();
            // Accept only standard UCI commands used by Chess Helper.
            if (!/^(uci|isready|ucinewgame|stop|quit|position (?:fen .+|startpos(?: moves .*)?)|go depth \d+|setoption name [A-Za-z0-9 _]+ value \d+)$/.test(command)) return;
            worker.postMessage(command);
        } else if (data.type === 'terminate') {
            try { worker?.terminate(); } catch (_) {}
            worker = null;
            failed = false;
            notify('terminated');
        }
    });

    startWorker();
})();

