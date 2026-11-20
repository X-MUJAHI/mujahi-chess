/**
 * MUJAHI Chess Engine — Provider Adapter for Chess Helper 2.1.0 (SuperMode)
 *
 * Preserves existing providers:
 *   - 'api'    (Hosted API — StockfishOnline default)
 *   - 'wasm'   (Local WASM — Stockfish 19 Lite worker)
 * Adds:
 *   - 'mujahi' (MUJAHI Stockfish 19 API via MV3 background service worker)
 *
 * Returns normalized Chess Helper 2.1.0 analysis objects:
 *   { move, evaluation, mate, continuation, depth, raw }
 * where `evaluation` and `mate` are always normalized to White's point of view.
 */
(function attachMujahiExtensionAdapter(global) {
  'use strict';

  const DEFAULT_API_BASE_URL = 'https://mujahi-chess.onrender.com';

  function makeAbortError(message = 'Aborted') {
    if (typeof DOMException === 'function') {
      return new DOMException(message, 'AbortError');
    }
    const err = new Error(message);
    err.name = 'AbortError';
    return err;
  }

  /**
   * Normalizes a single MUJAHI depth snapshot or top-level response into
   * the exact shape expected by Chess Helper 2.1.0 `engineAnalysisCache`.
   */
  function normalizeMujahiSnapshot(snapshot, rawPayload = null) {
    if (!snapshot || !snapshot.bestmove) return null;
    const rawEval = snapshot.evaluation ?? snapshot.eval ?? snapshot.score;
    const evaluation =
      rawEval === null || rawEval === undefined || rawEval === '' ? null : Number(rawEval);
    const mate =
      snapshot.mate === null || snapshot.mate === undefined || snapshot.mate === '' || snapshot.mate === 'null'
        ? null
        : Number(snapshot.mate);

    return {
      move: String(snapshot.bestmove).trim(),
      evaluation: Number.isFinite(evaluation) ? evaluation : null,
      mate: Number.isFinite(mate) ? mate : null,
      continuation: typeof snapshot.continuation === 'string' ? snapshot.continuation : '',
      depth: Number(snapshot.depth) || 0,
      raw: rawPayload || snapshot,
    };
  }

  class MujahiExtensionProvider {
    constructor({
      baseUrl = DEFAULT_API_BASE_URL,
      clientSessionId = null,
      debounceMs = 25,
      useSseStream = true,
      timeoutMs = 45000,
    } = {}) {
      this.baseUrl = String(baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
      this.clientSessionId =
        clientSessionId ||
        `ext_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      this.debounceMs = debounceMs;
      this.useSseStream = useSseStream;
      this.timeoutMs = timeoutMs;

      this.currentFen = '';
      this.batchTimers = new Map();
      this.activeStreams = new Map();
    }

    setActivePosition(fen) {
      if (this.currentFen && this.currentFen !== fen) {
        this.cancelAll();
      }
      this.currentFen = fen;
    }

    cancelAll() {
      for (const timer of this.batchTimers.values()) clearTimeout(timer);
      this.batchTimers.clear();
      for (const stream of this.activeStreams.values()) {
        stream.cancelled = true;
        try {
          stream.port?.postMessage({ type: 'cancel' });
          stream.port?.disconnect();
        } catch {
          // Ignore disconnected port errors
        }
        stream.rejectAll?.(makeAbortError('Superseded by newer FEN'));
      }
      this.activeStreams.clear();
    }

    /**
     * Batches simultaneous D5/D10/D15 calls from Chess Helper 2.1.0 for the same FEN
     * into ONE single-search Stockfish 19 request on the MUJAHI backend.
     *
     * @param {string} fen
     * @param {number} depth
     * @param {AbortSignal|null} signal
     * @param {(analysis: object) => void} [onNormalizedAnalysis]
     * @returns {Promise<string|null>} Best UCI move for requested depth
     */
    fetchBestMove(fen, depth, signal = null, onNormalizedAnalysis = null) {
      if (signal?.aborted) {
        return Promise.reject(makeAbortError('Aborted'));
      }

      this.currentFen = fen;
      const targetDepth = Number(depth);

      return new Promise((resolve, reject) => {
        let batch = this.activeStreams.get(fen);
        if (!batch) {
          batch = {
            fen,
            depths: new Set(),
            waiters: [],
            started: false,
            cancelled: false,
            port: null,
            resolvedSnapshots: new Map(),
            rejectAll: (err) => {
              for (const w of batch.waiters) {
                if (!w.settled) {
                  w.settled = true;
                  w.reject(err);
                }
              }
            },
          };
          this.activeStreams.set(fen, batch);
        }

        const waiter = {
          depth: targetDepth,
          settled: false,
          onNormalizedAnalysis,
          resolve,
          reject,
        };
        batch.depths.add(targetDepth);
        batch.waiters.push(waiter);

        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              if (!waiter.settled) {
                waiter.settled = true;
                waiter.reject(makeAbortError('Aborted'));
              }
              const allDone = batch.waiters.every((w) => w.settled);
              if (allDone) {
                batch.cancelled = true;
                const pendingTimer = this.batchTimers.get(fen);
                if (pendingTimer) {
                  clearTimeout(pendingTimer);
                  this.batchTimers.delete(fen);
                }
                try {
                  batch.port?.postMessage({ type: 'cancel' });
                  batch.port?.disconnect();
                } catch {
                  // Ignore
                }
                if (this.activeStreams.get(fen) === batch) {
                  this.activeStreams.delete(fen);
                }
              }
            },
            { once: true }
          );
        }

        // Already resolved in this shared batch
        if (batch.resolvedSnapshots.has(targetDepth)) {
          const snap = batch.resolvedSnapshots.get(targetDepth);
          waiter.settled = true;
          if (typeof waiter.onNormalizedAnalysis === 'function') {
            waiter.onNormalizedAnalysis(snap);
          }
          waiter.resolve(snap.move);
          return;
        }

        if (!batch.started && !this.batchTimers.has(fen)) {
          const timer = setTimeout(() => {
            this.batchTimers.delete(fen);
            this._executeBatch(batch);
          }, this.debounceMs);
          this.batchTimers.set(fen, timer);
        }
      });
    }

    _resolveDepthWaiters(batch, snapshot, rawPayload = null) {
      if (batch.cancelled || (this.currentFen && this.currentFen !== batch.fen)) {
        return; // Discard obsolete position result cleanly
      }
      const normalized = normalizeMujahiSnapshot(snapshot, rawPayload);
      if (!normalized) return;

      batch.resolvedSnapshots.set(normalized.depth, normalized);
      for (const waiter of batch.waiters) {
        if (!waiter.settled && waiter.depth === normalized.depth) {
          waiter.settled = true;
          if (typeof waiter.onNormalizedAnalysis === 'function') {
            waiter.onNormalizedAnalysis(normalized);
          }
          waiter.resolve(normalized.move);
        }
      }
    }

    _executeJsonFallback(batch, depths) {
      if (batch.cancelled || batch.waiters.every((w) => w.settled)) {
        if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
        return;
      }

      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'MUJAHI_ANALYZE_JSON',
              baseUrl: this.baseUrl,
              fen: batch.fen,
              depths,
              timeoutMs: this.timeoutMs,
              clientSessionId: this.clientSessionId,
            },
            (response) => {
              const lastErr = chrome.runtime.lastError;
              if (batch.cancelled) {
                if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
                return;
              }
              if (lastErr || !response?.ok) {
                batch.rejectAll(
                  new Error(lastErr?.message || response?.error || 'MUJAHI request failed')
                );
                if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
                return;
              }
              const results = response.payload?.results || {};
              for (const d of depths) {
                if (results[String(d)]) {
                  this._resolveDepthWaiters(batch, results[String(d)], response.payload);
                }
              }
              for (const waiter of batch.waiters) {
                if (!waiter.settled) {
                  waiter.settled = true;
                  waiter.resolve(null);
                }
              }
              if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
            }
          );
        } catch (err) {
          batch.rejectAll(err instanceof Error ? err : new Error(String(err || 'MUJAHI message bridge failed')));
          if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
        }
        return;
      }

      batch.rejectAll(new Error('chrome.runtime MV3 bridge unavailable.'));
      if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
    }

    _executeBatch(batch) {
      if (batch.cancelled || batch.waiters.every((w) => w.settled)) {
        if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
        return;
      }

      batch.started = true;
      const depths = Array.from(batch.depths).sort((a, b) => a - b);

      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.connect === 'function' && this.useSseStream) {
        let port;
        try {
          port = chrome.runtime.connect({ name: 'mujahi-analysis-stream' });
        } catch {
          this._executeJsonFallback(batch, depths);
          return;
        }

        const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        batch.port = port;
        let finishedCleanly = false;

        port.onDisconnect.addListener(() => {
          const runtimeErr = chrome.runtime.lastError;
          if (finishedCleanly || batch.cancelled || batch.waiters.every((w) => w.settled)) {
            if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
            return;
          }
          // If MV3 service worker disconnected before any depth arrived, retry once over one-shot JSON
          if (batch.resolvedSnapshots.size === 0 && !runtimeErr) {
            this._executeJsonFallback(batch, depths);
            return;
          }
          batch.rejectAll(new Error(runtimeErr?.message || 'MUJAHI service worker stream disconnected.'));
          if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
        });

        port.onMessage.addListener((msg) => {
          if (!msg || msg.requestId !== requestId) return;

          if (msg.type === 'sse_event') {
            if (msg.event === 'snapshot') {
              this._resolveDepthWaiters(batch, msg.data, msg.data);
            } else if (msg.event === 'complete') {
              finishedCleanly = true;
              const results = msg.data?.results || {};
              for (const d of depths) {
                if (results[String(d)]) {
                  this._resolveDepthWaiters(batch, results[String(d)], msg.data);
                }
              }
              for (const waiter of batch.waiters) {
                if (!waiter.settled) {
                  waiter.settled = true;
                  waiter.resolve(null);
                }
              }
              if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
              try {
                port.disconnect();
              } catch {
                // Ignore
              }
            } else if (msg.event === 'error') {
              finishedCleanly = true;
              batch.rejectAll(new Error(msg.data?.error?.message || 'MUJAHI stream error'));
              if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
              try {
                port.disconnect();
              } catch {
                // Ignore
              }
            }
          } else if (msg.type === 'sse_error') {
            finishedCleanly = true;
            batch.rejectAll(new Error(msg.message || 'MUJAHI stream failed'));
            if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
            try {
              port.disconnect();
            } catch {
              // Ignore
            }
          }
        });

        try {
          port.postMessage({
            type: 'analyze_stream',
            requestId,
            baseUrl: this.baseUrl,
            fen: batch.fen,
            depths,
            timeoutMs: this.timeoutMs,
            clientSessionId: this.clientSessionId,
          });
        } catch {
          finishedCleanly = true;
          this._executeJsonFallback(batch, depths);
        }
        return;
      }

      this._executeJsonFallback(batch, depths);
    }
  }

  global.MujahiExtensionAdapter = {
    MujahiExtensionProvider,
    normalizeMujahiSnapshot,
  };
})(typeof window !== 'undefined' ? window : globalThis);
