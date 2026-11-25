'use strict';

const { EventEmitter } = require('node:events');
const { spawnStockfishProcess } = require('./stockfish');
const { UciChannel } = require('./uci');
const {
  parseUciIdLine,
  parseUciOptionLine,
  parseUciInfoLine,
  parseBestMoveLine,
} = require('./parser');

class EngineUnavailableError extends Error {
  constructor(message = 'Chess engine is currently unavailable.') {
    super(message);
    this.name = 'EngineUnavailableError';
    this.statusCode = 503;
    this.code = 'ENGINE_UNAVAILABLE';
  }
}

class EngineTimeoutError extends Error {
  constructor(message = 'Analysis exceeded configured timeout.') {
    super(message);
    this.name = 'EngineTimeoutError';
    this.statusCode = 504;
    this.code = 'ENGINE_TIMEOUT';
  }
}

class EngineCrashedError extends Error {
  constructor(message = 'Stockfish process terminated unexpectedly during analysis.') {
    super(message);
    this.name = 'EngineCrashedError';
    this.statusCode = 502;
    this.code = 'ENGINE_CRASHED';
  }
}

class EngineCancelledError extends Error {
  constructor(message = 'Analysis was cancelled.') {
    super(message);
    this.name = 'EngineCancelledError';
    this.statusCode = 499;
    this.code = 'ANALYSIS_CANCELLED';
  }
}

/**
 * Manages a single persistent native Stockfish 19 process, serializing UCI
 * operations, emitting progressive depth snapshots, safely cancelling via `stop`,
 * and recovering automatically from engine crashes or unresponsive states.
 */
class EngineManager extends EventEmitter {
  constructor(config, { spawnFn = spawnStockfishProcess, logger = console } = {}) {
    super();
    this.config = config;
    this.spawnFn = spawnFn;
    this.logger = logger;

    this.state = 'stopped'; // stopped | starting | ready | busy | stopping | restarting | error
    this.process = null;
    this.channel = null;
    this.startPromise = null;
    this.restartPromise = null;
    this.shuttingDown = false;

    this.engineIdentity = {
      name: config.pinnedStockfish.brandName,
      reportedName: `Stockfish ${config.pinnedStockfish.version}`,
      author: 'The Stockfish developers',
      version: config.pinnedStockfish.version,
      tag: config.pinnedStockfish.tag,
      commit: config.pinnedStockfish.commit,
      nnueArchitecture: config.pinnedStockfish.nnueArchitecture,
      defaultNet: config.pinnedStockfish.defaultNet,
    };
    this.supportedOptions = [];
    this.generation = 0;
    this.activeSearch = null;
    this.restartsCount = 0;
    this.lastError = null;
    this.startedAt = null;
  }

  isReady() {
    return this.state === 'ready' || this.state === 'busy';
  }

  getStatus() {
    return {
      state: this.state,
      ready: this.isReady(),
      busy: this.state === 'busy',
      version: this.engineIdentity.reportedName,
      pinnedTag: this.config.pinnedStockfish.tag,
      pinnedCommit: this.config.pinnedStockfish.commit,
      nnueArchitecture: this.config.pinnedStockfish.nnueArchitecture,
      defaultNet: this.config.pinnedStockfish.defaultNet,
      restarts: this.restartsCount,
      lastError: this.lastError,
      startedAt: this.startedAt,
      supportedOptions: this.supportedOptions,
    };
  }

  async start() {
    if (this.shuttingDown) {
      throw new EngineUnavailableError('Engine manager is shutting down.');
    }
    if (this.state === 'ready' || this.state === 'busy') {
      return true;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this._startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async _startInternal() {
    this.state = 'starting';
    this.lastError = null;
    this._cleanupProcess();

    const child = this.spawnFn(this.config.stockfishPath);
    this.process = child;
    const channel = new UciChannel(child);
    this.channel = channel;

    const discoveredOptions = [];
    const onHandshakeLine = (line) => {
      const id = parseUciIdLine(line);
      if (id) {
        if (id.field === 'name') this.engineIdentity.reportedName = id.value;
        if (id.field === 'author') this.engineIdentity.author = id.value;
        return;
      }
      const opt = parseUciOptionLine(line);
      if (opt) {
        discoveredOptions.push(opt);
      }
    };

    channel.on('line', onHandshakeLine);
    channel.on('stderr', (text) => {
      this.logger.warn(`[Stockfish stderr] ${text}`);
    });
    channel.on('exit', (info) => this._handleUnexpectedExit(channel, info));
    channel.on('error', (err) => this._handleChannelError(channel, err));

    try {
      const uciPromise = channel.waitFor(
        (line) => line === 'uciok',
        this.config.engine.initTimeoutMs,
        'uciok'
      );
      channel.send('uci');
      await uciPromise;
      channel.off('line', onHandshakeLine);
      this.supportedOptions = discoveredOptions;

      // Apply only options verified in Stockfish's actual UCI option list
      const optionNames = new Set(discoveredOptions.map((o) => o.name));
      if (optionNames.has('Threads')) {
        channel.send(`setoption name Threads value ${this.config.engine.threads}`);
      }
      if (optionNames.has('Hash')) {
        channel.send(`setoption name Hash value ${this.config.engine.hashMb}`);
      }
      if (optionNames.has('MultiPV')) {
        channel.send(`setoption name MultiPV value ${this.config.engine.multiPv}`);
      }

      const readyPromise = channel.waitFor(
        (line) => line === 'readyok',
        this.config.engine.initTimeoutMs,
        'readyok'
      );
      channel.send('isready');
      await readyPromise;

      this.state = 'ready';
      this.startedAt = new Date().toISOString();
      this.emit('ready');
      this.logger.info(
        `[EngineManager] Stockfish ready (${this.engineIdentity.reportedName}, Threads=${this.config.engine.threads}, Hash=${this.config.engine.hashMb}MB)`
      );
      return true;
    } catch (err) {
      channel.off('line', onHandshakeLine);
      this.lastError = err.message;
      this.state = 'error';
      this._cleanupProcess();
      throw new EngineUnavailableError(`Failed to initialize Stockfish: ${err.message}`);
    }
  }

  _handleChannelError(channel, err) {
    if (channel !== this.channel) return;
    this.lastError = err.message;
    this.logger.error(`[EngineManager] Process error: ${err.message}`);
  }

  _handleUnexpectedExit(channel, { code, signal }) {
    if (channel !== this.channel) return;
    const message = `Stockfish exited unexpectedly (code=${code}, signal=${signal})`;
    this.lastError = message;

    if (this.shuttingDown) {
      this.state = 'stopped';
      return;
    }

    this.logger.error(`[EngineManager] ${message}`);
    const active = this.activeSearch;
    this.activeSearch = null;
    this.state = 'error';
    this._cleanupProcess();

    if (active && !active.settled) {
      active.settled = true;
      active.cleanup();
      active.reject(new EngineCrashedError(message));
    }

    // Attempt safe background recovery so subsequent requests succeed
    this.restart().catch((restartErr) => {
      this.logger.error(`[EngineManager] Background restart failed: ${restartErr.message}`);
    });
  }

  async restart() {
    if (this.shuttingDown) return false;
    if (this.restartPromise) return this.restartPromise;

    this.restartPromise = (async () => {
      this.state = 'restarting';
      this.restartsCount += 1;
      this._cleanupProcess();
      await this.start();
      return true;
    })().finally(() => {
      this.restartPromise = null;
    });

    return this.restartPromise;
  }

  /**
   * Executes one UCI search on the persistent engine up to `targetDepth`.
   * Streams requested iterative-deepening snapshots via `onDepthSnapshot` and
   * resolves with collected depth results once `bestmove` completes.
   */
  async analyze({
    fen,
    sideToMove,
    targetDepth,
    requestedDepths,
    timeoutMs,
    onDepthSnapshot,
    signal,
  }) {
    if (this.shuttingDown) {
      throw new EngineUnavailableError('Engine is shutting down.');
    }
    if (this.state === 'error' || this.state === 'stopped') {
      await this.start();
    }
    if (this.state !== 'ready' || !this.channel) {
      throw new EngineUnavailableError(`Engine is not idle (state=${this.state}).`);
    }
    if (signal?.aborted) {
      throw new EngineCancelledError('Request aborted before engine execution.');
    }

    const gen = ++this.generation;
    this.state = 'busy';

    const requestedSet = new Set(requestedDepths);
    const snapshotsByDepth = new Map();
    const emittedDepths = new Set();
    let latestSnapshot = null;
    let bestMoveSeen = false;

    const effectiveTimeout =
      timeoutMs === undefined ? this.config.engine.timeoutMs : timeoutMs;

    return new Promise((resolve, reject) => {
      let timeoutTimer = null;
      let stopTimer = null;

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (stopTimer) clearTimeout(stopTimer);
        if (signal && onAbortSignal) signal.removeEventListener('abort', onAbortSignal);
        this.channel?.off('line', onLine);
      };

      const searchCtx = {
        gen,
        settled: false,
        stopping: false,
        stopReason: null,
        cleanup,
        resolve,
        reject,
        triggerStop: null,
      };
      this.activeSearch = searchCtx;

      const finish = (err, payload = null) => {
        if (searchCtx.settled) return;
        searchCtx.settled = true;
        cleanup();
        if (this.activeSearch === searchCtx) {
          this.activeSearch = null;
        }
        if (err) {
          reject(err);
        } else {
          resolve(payload);
        }
      };

      const triggerStop = (reasonError) => {
        if (searchCtx.settled || searchCtx.stopping) return;
        searchCtx.stopping = true;
        searchCtx.stopReason = reasonError;
        this.state = 'stopping';

        try {
          if (this.channel && !this.channel.closed) {
            this.channel.send('stop');
          }
        } catch (sendErr) {
          // If stdin is broken, restart safely before accepting next job
          this.restart()
            .catch(() => {})
            .finally(() => finish(reasonError));
          return;
        }

        // Guard against an engine hang on `stop`: kill & restart safely before unlocking
        stopTimer = setTimeout(() => {
          if (searchCtx.settled) return;
          this.logger.warn('[EngineManager] Stockfish did not answer stop in time; restarting process.');
          this.restart()
            .catch(() => {})
            .finally(() => finish(reasonError));
        }, this.config.engine.stopTimeoutMs);
      };
      searchCtx.triggerStop = triggerStop;

      const onAbortSignal = () => {
        triggerStop(new EngineCancelledError('Client cancelled analysis.'));
      };
      if (signal) {
        signal.addEventListener('abort', onAbortSignal, { once: true });
      }

      if (effectiveTimeout > 0) {
        timeoutTimer = setTimeout(() => {
          triggerStop(
            new EngineTimeoutError(`Analysis timed out after ${effectiveTimeout}ms.`)
          );
        }, effectiveTimeout);
      }

      const emitIfReady = (snap) => {
        if (!snap || searchCtx.stopping || searchCtx.settled) return;
        if (!requestedSet.has(snap.depth)) return;
        if (snap.bound !== 'exact') return;
        if (emittedDepths.has(snap.depth)) return;

        emittedDepths.add(snap.depth);
        if (typeof onDepthSnapshot === 'function') {
          try {
            onDepthSnapshot(snap);
          } catch (cbErr) {
            this.logger.warn(`[EngineManager] Snapshot callback error: ${cbErr.message}`);
          }
        }
      };

      const onLine = (line) => {
        // Ignore stale output from any prior generation
        if (this.generation !== gen || searchCtx.settled) return;

        if (line.startsWith('info ')) {
          const snap = parseUciInfoLine(line, sideToMove);
          if (!snap) return;

          const existing = snapshotsByDepth.get(snap.depth);
          // Prefer exact scores over fail-high/low bounds at the same depth
          if (!existing || snap.bound === 'exact' || existing.bound !== 'exact') {
            snapshotsByDepth.set(snap.depth, snap);
          }
          latestSnapshot = snap;
          emitIfReady(snap);
          return;
        }

        if (line.startsWith('bestmove ')) {
          if (bestMoveSeen) return;
          bestMoveSeen = true;

          const parsedBest = parseBestMoveLine(line);

          // If we stopped due to timeout or cancellation, engine is now idle and ready!
          if (searchCtx.stopping) {
            if (!this.shuttingDown && this.state === 'stopping') {
              this.state = 'ready';
            }
            finish(searchCtx.stopReason);
            return;
          }

          if (!this.shuttingDown) {
            this.state = 'ready';
          }

          // Assemble final ordered results for every requested depth
          const sortedDepths = [...requestedDepths].sort((a, b) => a - b);
          const results = [];

          for (const reqDepth of sortedDepths) {
            const snap = snapshotsByDepth.get(reqDepth);
            if (snap) {
              // Ensure bestmove/ponder on the highest depth matches Stockfish's authoritative bestmove
              const isFinalDepth = reqDepth === sortedDepths[sortedDepths.length - 1];
              const finalized = {
                depth: snap.depth,
                bestmove: isFinalDepth ? parsedBest.bestmove : (snap.bestmove || parsedBest.bestmove),
                ponder: isFinalDepth ? parsedBest.ponder : (snap.ponder || parsedBest.ponder),
                evaluation: snap.evaluation,
                mate: snap.mate,
                bound: snap.bound,
                pv: snap.pv,
                nodes: snap.nodes,
                nps: snap.nps,
                time: snap.time,
                terminal: parsedBest.terminal,
              };
              if (!emittedDepths.has(reqDepth)) {
                emittedDepths.add(reqDepth);
                if (typeof onDepthSnapshot === 'function') {
                  onDepthSnapshot(finalized);
                }
              }
              results.push(finalized);
            } else if (parsedBest.terminal || latestSnapshot) {
              // Terminal positions (checkmate/stalemate) or mate-in-1 shortcuts may finish early
              const fallback = latestSnapshot || {
                depth: 0,
                evaluation: null,
                mate: null,
                bound: 'exact',
                pv: [],
                nodes: 0,
                nps: 0,
                time: 0,
              };
              const finalized = {
                depth: parsedBest.terminal ? fallback.depth : Math.min(reqDepth, fallback.depth),
                bestmove: parsedBest.bestmove,
                ponder: parsedBest.ponder,
                evaluation: fallback.evaluation,
                mate: fallback.mate,
                bound: fallback.bound,
                pv: fallback.pv,
                nodes: fallback.nodes,
                nps: fallback.nps,
                time: fallback.time,
                terminal: parsedBest.terminal,
              };
              results.push(finalized);
            }
          }

          finish(null, {
            bestmove: parsedBest.bestmove,
            ponder: parsedBest.ponder,
            terminal: parsedBest.terminal,
            results,
          });
        }
      };

      this.channel.on('line', onLine);

      try {
        this.channel.send(`position fen ${fen}`);
        this.channel.send(`go depth ${targetDepth}`);
      } catch (writeErr) {
        this.restart()
          .catch(() => {})
          .finally(() => finish(new EngineUnavailableError(writeErr.message)));
      }
    });
  }

  /**
   * Executes a serialized MultiPV search (optionally restricted via `searchMoves`)
   * and restores `MultiPV` back to the configured default before unlocking.
   */
  async analyzeMultiPv({
    fen,
    sideToMove,
    targetDepth,
    multiPv = 24,
    searchMoves = null,
    timeoutMs,
    signal,
  }) {
    if (this.shuttingDown) {
      throw new EngineUnavailableError('Engine is shutting down.');
    }
    if (this.state === 'error' || this.state === 'stopped') {
      await this.start();
    }
    if (this.state !== 'ready' || !this.channel) {
      throw new EngineUnavailableError(`Engine is not idle (state=${this.state}).`);
    }
    if (signal?.aborted) {
      throw new EngineCancelledError('Request aborted before engine execution.');
    }

    const gen = ++this.generation;
    this.state = 'busy';

    const clampedMultiPv = Math.max(1, Math.min(40, Number.parseInt(multiPv, 10) || 1));
    const safeSearchMoves = Array.isArray(searchMoves)
      ? searchMoves.filter((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(String(m || '')))
      : [];
    const defaultMultiPv = this.config.engine.multiPv || 1;
    const snapshotsByDepth = new Map(); // depth -> Map(multipv -> snap)
    let bestMoveSeen = false;

    const effectiveTimeout =
      timeoutMs === undefined ? this.config.engine.timeoutMs : timeoutMs;

    const restoreDefaultMultiPv = () => {
      try {
        if (this.channel && !this.channel.closed) {
          this.channel.send(`setoption name MultiPV value ${defaultMultiPv}`);
        }
      } catch (_) {}
    };

    return new Promise((resolve, reject) => {
      let timeoutTimer = null;
      let stopTimer = null;

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (stopTimer) clearTimeout(stopTimer);
        if (signal && onAbortSignal) signal.removeEventListener('abort', onAbortSignal);
        this.channel?.off('line', onLine);
      };

      const searchCtx = {
        gen,
        settled: false,
        stopping: false,
        stopReason: null,
        cleanup,
        resolve,
        reject,
        triggerStop: null,
      };
      this.activeSearch = searchCtx;

      const finish = (err, payload = null) => {
        if (searchCtx.settled) return;
        searchCtx.settled = true;
        cleanup();
        if (this.activeSearch === searchCtx) {
          this.activeSearch = null;
        }
        if (err) {
          reject(err);
        } else {
          resolve(payload);
        }
      };

      const triggerStop = (reasonError) => {
        if (searchCtx.settled || searchCtx.stopping) return;
        searchCtx.stopping = true;
        searchCtx.stopReason = reasonError;
        this.state = 'stopping';

        try {
          if (this.channel && !this.channel.closed) {
            this.channel.send('stop');
          }
        } catch (_) {
          this.restart()
            .catch(() => {})
            .finally(() => finish(reasonError));
          return;
        }

        stopTimer = setTimeout(() => {
          if (searchCtx.settled) return;
          this.logger.warn('[EngineManager] Stockfish did not answer stop in time; restarting process.');
          this.restart()
            .catch(() => {})
            .finally(() => finish(reasonError));
        }, this.config.engine.stopTimeoutMs);
      };
      searchCtx.triggerStop = triggerStop;

      const onAbortSignal = () => {
        triggerStop(new EngineCancelledError('Client cancelled MultiPV analysis.'));
      };
      if (signal) {
        signal.addEventListener('abort', onAbortSignal, { once: true });
      }

      if (effectiveTimeout > 0) {
        timeoutTimer = setTimeout(() => {
          triggerStop(
            new EngineTimeoutError(`MultiPV analysis timed out after ${effectiveTimeout}ms.`)
          );
        }, effectiveTimeout);
      }

      const onLine = (line) => {
        if (this.generation !== gen || searchCtx.settled) return;

        if (line.startsWith('info ')) {
          const snap = parseUciInfoLine(line, sideToMove, { allowMultiPv: true });
          if (!snap) return;
          let pvMap = snapshotsByDepth.get(snap.depth);
          if (!pvMap) {
            pvMap = new Map();
            snapshotsByDepth.set(snap.depth, pvMap);
          }
          const existing = pvMap.get(snap.multipv);
          if (!existing || snap.bound === 'exact' || existing.bound !== 'exact') {
            pvMap.set(snap.multipv, snap);
          }
          return;
        }

        if (line.startsWith('bestmove ')) {
          if (bestMoveSeen) return;
          bestMoveSeen = true;

          restoreDefaultMultiPv();
          const parsedBest = parseBestMoveLine(line);

          if (searchCtx.stopping) {
            if (!this.shuttingDown && this.state === 'stopping') {
              this.state = 'ready';
            }
            finish(searchCtx.stopReason);
            return;
          }

          if (!this.shuttingDown) {
            this.state = 'ready';
          }

          let chosenLines = [];
          const depthsDesc = [...snapshotsByDepth.keys()].sort((a, b) => b - a);
          for (const d of depthsDesc) {
            const pvMap = snapshotsByDepth.get(d);
            const entries = [...pvMap.values()].filter((s) => s.bestmove);
            if (entries.length) {
              chosenLines = entries.sort((a, b) => a.multipv - b.multipv);
              break;
            }
          }

          finish(null, {
            bestmove: parsedBest.bestmove,
            ponder: parsedBest.ponder,
            terminal: parsedBest.terminal,
            lines: chosenLines,
          });
        }
      };

      this.channel.on('line', onLine);

      try {
        this.channel.send(`setoption name MultiPV value ${clampedMultiPv}`);
        this.channel.send(`position fen ${fen}`);
        const moveFilter = safeSearchMoves.length ? ` searchmoves ${safeSearchMoves.join(' ')}` : '';
        this.channel.send(`go depth ${targetDepth}${moveFilter}`);
      } catch (writeErr) {
        restoreDefaultMultiPv();
        this.restart()
          .catch(() => {})
          .finally(() => finish(new EngineUnavailableError(writeErr.message)));
      }
    });
  }

  /**
   * Requests immediate cancellation of the active search (used when all attached
   * client waiters have disconnected or been superseded by a newer position).
   */
  abortActiveSearch(reason = 'Analysis aborted by scheduler.') {
    if (!this.activeSearch || this.activeSearch.settled) return false;
    this.activeSearch.triggerStop(new EngineCancelledError(reason));
    return true;
  }

  async shutdown() {
    this.shuttingDown = true;
    if (this.activeSearch && !this.activeSearch.settled) {
      this.activeSearch.triggerStop(new EngineCancelledError('Server shutting down.'));
      await new Promise((r) => setTimeout(r, 150));
    }
    try {
      if (this.channel && !this.channel.closed) {
        this.channel.send('quit');
      }
    } catch (_) {
      // Ignore stdin errors during teardown
    }
    await new Promise((r) => setTimeout(r, 100));
    this._cleanupProcess();
    this.state = 'stopped';
  }

  _cleanupProcess() {
    if (this.channel) {
      this.channel.destroy();
      this.channel = null;
    }
    if (this.process) {
      const proc = this.process;
      this.process = null;
      if (!proc.killed) {
        try {
          proc.kill('SIGTERM');
          setTimeout(() => {
            try {
              if (proc.exitCode === null && proc.signalCode === null) {
                proc.kill('SIGKILL');
              }
            } catch (_) {}
          }, 500).unref?.();
        } catch (_) {}
      }
    }
  }
}

module.exports = {
  EngineManager,
  EngineUnavailableError,
  EngineTimeoutError,
  EngineCrashedError,
  EngineCancelledError,
};
