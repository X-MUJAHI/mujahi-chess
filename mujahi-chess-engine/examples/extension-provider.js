/**
 * MUJAHI Chess Engine — Provider Adapter for Chess Helper 2.1.4 (SuperMode)
 *
 * Preserves existing providers:
 *   - 'api'    (Hosted API — StockfishOnline default)
 *   - 'wasm'   (Local WASM — Stockfish 19 Lite worker)
 * Adds:
 *   - 'mujahi' (MUJAHI Stockfish 19 API via MV3 background service worker)
 *
 * Returns normalized Chess Helper 2.1.4 analysis objects:
 *   { move, ponder, evaluation, rawCp, mate, bound, pv, continuation, depth,
 *     seldepth, nodes, nps, time, terminal, cached, deduplicated, version, raw }
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

  function extractUciMove(rawMove) {
    if (!rawMove) return '';
    const trimmed = String(rawMove).trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('bestmove ')) {
      return trimmed.split(/\s+/)[1] || '';
    }
    return trimmed.split(/\s+/)[0] || '';
  }

  function makeProviderError(message, { status = 0, code = '', extensionId = '' } = {}) {
    const err = new Error(message || 'MUJAHI request failed');
    if (status) err.status = status;
    if (code) err.code = code;
    if (extensionId) err.extensionId = extensionId;
    return err;
  }

  /**
   * Normalizes a single MUJAHI depth snapshot or top-level response into
   * the enriched Chess Helper analysis shape while maintaining full 2.1.x compatibility.
   */
  function normalizeMujahiSnapshot(snapshot, rawPayload = null) {
    if (!snapshot) return null;
    const move = extractUciMove(snapshot.bestmove || snapshot.move);
    if (!move || move === '(none)' || move === '0000') return null;

    const rawEval = snapshot.evaluation ?? snapshot.eval ?? snapshot.score;
    let evaluation = null;
    let rawCp = null;
    let bound = snapshot.bound || 'exact';
    let mate =
      snapshot.mate === null || snapshot.mate === undefined || snapshot.mate === '' || snapshot.mate === 'null'
        ? null
        : Number(snapshot.mate);

    if (rawEval && typeof rawEval === 'object') {
      if (rawEval.bound) bound = String(rawEval.bound);
      if (rawEval.rawCp !== null && rawEval.rawCp !== undefined && Number.isFinite(Number(rawEval.rawCp))) {
        rawCp = Number(rawEval.rawCp);
      }
      if (rawEval.type === 'cp' && rawEval.value !== null && rawEval.value !== undefined) {
        const parsedCp = Number(rawEval.value);
        if (Number.isFinite(parsedCp)) evaluation = parsedCp;
      } else if (rawEval.type === 'mate' && mate === null && rawEval.value !== null && rawEval.value !== undefined) {
        const parsedMate = Number(rawEval.value);
        if (Number.isFinite(parsedMate)) mate = parsedMate;
      }
    } else if (rawEval !== null && rawEval !== undefined && rawEval !== '') {
      const parsedEval = Number(rawEval);
      if (Number.isFinite(parsedEval)) evaluation = parsedEval;
    }

    if (rawCp === null && Number.isFinite(evaluation)) {
      rawCp = Math.round(evaluation * 100);
    }

    const pv = Array.isArray(snapshot.pv)
      ? snapshot.pv.map((m) => extractUciMove(m)).filter(Boolean)
      : typeof snapshot.continuation === 'string'
        ? snapshot.continuation.trim().split(/\s+/).filter(Boolean)
        : [];
    const continuation = pv.join(' ');
    const ponder = extractUciMove(snapshot.ponder || pv[1] || rawPayload?.ponder || '') || null;

    const parseOptionalNum = (val) => {
      if (val === null || val === undefined || val === '') return null;
      const num = Number(val);
      return Number.isFinite(num) ? num : null;
    };

    return {
      move,
      ponder,
      evaluation: Number.isFinite(evaluation) ? evaluation : null,
      rawCp: Number.isFinite(rawCp) ? rawCp : null,
      mate: Number.isFinite(mate) ? mate : null,
      bound: bound || 'exact',
      pv,
      continuation,
      depth: Number(snapshot.depth) || 0,
      seldepth: parseOptionalNum(snapshot.seldepth),
      nodes: parseOptionalNum(snapshot.nodes),
      nps: parseOptionalNum(snapshot.nps),
      time: parseOptionalNum(snapshot.time),
      terminal: Boolean(snapshot.terminal ?? rawPayload?.terminal),
      cached: Boolean(rawPayload?.cached ?? snapshot.cached),
      deduplicated: Boolean(rawPayload?.deduplicated ?? snapshot.deduplicated),
      version: rawPayload?.version || snapshot.version || 'Stockfish 19',
      raw: rawPayload || snapshot,
    };
  }

  function findResultForDepth(results, targetDepth) {
    if (Array.isArray(results)) {
      return results.find((item) => Number(item?.depth) === targetDepth) || null;
    }
    if (results && typeof results === 'object') {
      return results[String(targetDepth)] || null;
    }
    return null;
  }

  function getDeepestResult(results) {
    if (Array.isArray(results)) {
      let best = null;
      for (const item of results) {
        if (!item) continue;
        if (!best || (Number(item.depth) || 0) >= (Number(best.depth) || 0)) {
          best = item;
        }
      }
      return best;
    }
    if (results && typeof results === 'object') {
      let best = null;
      for (const item of Object.values(results)) {
        if (!item) continue;
        if (!best || (Number(item.depth) || 0) >= (Number(best.depth) || 0)) {
          best = item;
        }
      }
      return best;
    }
    return null;
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
     * Batches simultaneous D5/D10/D15 calls from Chess Helper for the same FEN
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
            notifiedDepths: new Set(),
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
        return;
      }
      const normalized = normalizeMujahiSnapshot(snapshot, rawPayload);
      if (!normalized) return;

      batch.resolvedSnapshots.set(normalized.depth, normalized);
      const snapshotList = Array.from(batch.resolvedSnapshots.values()).sort((a, b) => a.depth - b.depth);
      normalized.depthSnapshots = snapshotList;

      let notifiedAny = false;
      for (const waiter of batch.waiters) {
        if (!waiter.settled && waiter.depth === normalized.depth) {
          waiter.settled = true;
          if (typeof waiter.onNormalizedAnalysis === 'function') {
            waiter.onNormalizedAnalysis(normalized);
            notifiedAny = true;
          }
          waiter.resolve(normalized.move);
        }
      }

      if (!notifiedAny && !batch.notifiedDepths.has(normalized.depth)) {
        const progressWaiter = batch.waiters.find((w) => typeof w.onNormalizedAnalysis === 'function');
        if (progressWaiter) {
          batch.notifiedDepths.add(normalized.depth);
          progressWaiter.onNormalizedAnalysis(normalized);
        }
      } else {
        batch.notifiedDepths.add(normalized.depth);
      }
    }

    _settleCompletedPayload(batch, depths, payload) {
      if (batch.cancelled || (this.currentFen && this.currentFen !== batch.fen)) {
        return;
      }
      const results = payload?.results;
      if (Array.isArray(results)) {
        for (const snap of results) {
          if (snap) this._resolveDepthWaiters(batch, snap, payload);
        }
      } else {
        for (const d of depths) {
          const snap = findResultForDepth(results, d);
          if (snap) {
            this._resolveDepthWaiters(batch, snap, payload);
          }
        }
      }

      const deepestRaw = getDeepestResult(results);
      if (deepestRaw) {
        const deepestNorm = normalizeMujahiSnapshot(deepestRaw, payload);
        if (deepestNorm) {
          deepestNorm.depthSnapshots = Array.from(batch.resolvedSnapshots.values()).sort((a, b) => a.depth - b.depth);
          const progressWaiter = batch.waiters.find((w) => typeof w.onNormalizedAnalysis === 'function');
          if (progressWaiter) progressWaiter.onNormalizedAnalysis(deepestNorm);
        }
      }

      const fallbackSnap =
        deepestRaw ||
        (payload?.bestmove ? { depth: 0, bestmove: payload.bestmove, ponder: payload.ponder || null, evaluation: null, mate: null } : null);
      const fallbackNormalized = fallbackSnap ? normalizeMujahiSnapshot(fallbackSnap, payload) : null;
      if (fallbackNormalized) {
        fallbackNormalized.depthSnapshots = Array.from(batch.resolvedSnapshots.values()).sort((a, b) => a.depth - b.depth);
      }

      for (const waiter of batch.waiters) {
        if (!waiter.settled) {
          waiter.settled = true;
          if (fallbackNormalized) {
            if (typeof waiter.onNormalizedAnalysis === 'function') {
              waiter.onNormalizedAnalysis(fallbackNormalized);
            }
            waiter.resolve(fallbackNormalized.move);
          } else {
            waiter.resolve(payload?.terminal ? false : null);
          }
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
                  makeProviderError(lastErr?.message || response?.error || 'MUJAHI request failed', {
                    status: response?.status || 0,
                    code: response?.code || '',
                    extensionId: response?.extensionId || '',
                  })
                );
                if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
                return;
              }
              this._settleCompletedPayload(batch, depths, response.payload);
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
              this._settleCompletedPayload(batch, depths, msg.data);
              if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
              try {
                port.disconnect();
              } catch {
                // Ignore
              }
            } else if (msg.event === 'error') {
              finishedCleanly = true;
              batch.rejectAll(
                makeProviderError(msg.data?.error?.message || 'MUJAHI stream error', {
                  code: msg.data?.error?.code || '',
                })
              );
              if (this.activeStreams.get(batch.fen) === batch) this.activeStreams.delete(batch.fen);
              try {
                port.disconnect();
              } catch {
                // Ignore
              }
            }
          } else if (msg.type === 'sse_error') {
            finishedCleanly = true;
            batch.rejectAll(
              makeProviderError(msg.message || 'MUJAHI stream failed', {
                status: msg.status || 0,
                code: msg.code || '',
                extensionId: msg.extensionId || '',
              })
            );
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
