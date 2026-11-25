'use strict';

const crypto = require('node:crypto');
const { EngineCancelledError } = require('../engine/manager');

class QueueFullError extends Error {
  constructor(message = 'Analysis queue is full. Please retry shortly.') {
    super(message);
    this.name = 'QueueFullError';
    this.statusCode = 503;
    this.code = 'QUEUE_FULL';
  }
}

/**
 * Session-aware, latest-position-first, FEN-deduplicated job scheduler.
 *
 * Key guarantees:
 * 1. One active Stockfish UCI search runs at a time.
 * 2. Identical FEN requests across concurrent callers share one underlying job.
 * 3. A new FEN from a given `clientSessionId` cancels that same client's older
 *    queued/active waiters without ever disrupting any other client.
 * 4. Queue selection prioritizes the latest active position (LIFO).
 * 5. Bounded memory via `maxQueue` and bounded short-lived LRU result cache.
 */
class RequestQueue {
  constructor(engineManager, config) {
    this.engineManager = engineManager;
    this.config = config;

    this.waitingJobs = []; // ordered oldest -> newest; popped from end (latest-position-first)
    this.activeJob = null;
    this.pumping = false;
    this.resultCache = new Map(); // cacheKey -> { expiresAt, payload }
  }

  getStats() {
    return {
      queuedJobs: this.waitingJobs.length,
      maxQueue: this.config.engine.maxQueue,
      activeJobFen: this.activeJob ? this.activeJob.fen : null,
      activeWaiters: this.activeJob ? this.activeJob.waiters.size : 0,
      cacheEntries: this.resultCache.size,
    };
  }

  _buildCacheKey(fen, requestedDepths) {
    return `${fen}|${[...requestedDepths].sort((a, b) => a - b).join(',')}`;
  }

  _getCached(fen, requestedDepths) {
    if (this.config.cache.ttlMs <= 0 || this.config.cache.maxEntries <= 0) return null;
    const key = this._buildCacheKey(fen, requestedDepths);
    const entry = this.resultCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.resultCache.delete(key);
      return null;
    }
    // Refresh LRU order
    this.resultCache.delete(key);
    this.resultCache.set(key, entry);
    return entry.payload;
  }

  _setCached(fen, requestedDepths, payload) {
    if (this.config.cache.ttlMs <= 0 || this.config.cache.maxEntries <= 0) return;
    const key = this._buildCacheKey(fen, requestedDepths);
    this.resultCache.delete(key);
    this.resultCache.set(key, {
      expiresAt: Date.now() + this.config.cache.ttlMs,
      payload,
    });
    while (this.resultCache.size > this.config.cache.maxEntries) {
      const oldestKey = this.resultCache.keys().next().value;
      this.resultCache.delete(oldestKey);
    }
  }

  /**
   * Cancels any older queued or active waiters owned by `clientSessionId`
   * when that client submits a newer position (`nextFen`).
   */
  _cancelObsoleteClientRequests(clientSessionId, nextFen) {
    if (!clientSessionId) return;

    // 1. Cancel obsolete queued waiters for this client
    for (let i = this.waitingJobs.length - 1; i >= 0; i--) {
      const job = this.waitingJobs[i];
      if (job.fen === nextFen) continue;

      for (const waiter of [...job.waiters]) {
        if (waiter.clientSessionId === clientSessionId) {
          this._settleWaiter(
            job,
            waiter,
            new EngineCancelledError('Superseded by newer position from the same client session.')
          );
        }
      }
      if (job.waiters.size === 0) {
        this.waitingJobs.splice(i, 1);
      }
    }

    // 2. Detach obsolete active waiters for this client; only stop Stockfish if NO waiters remain!
    if (this.activeJob && this.activeJob.fen !== nextFen) {
      for (const waiter of [...this.activeJob.waiters]) {
        if (waiter.clientSessionId === clientSessionId) {
          this._settleWaiter(
            this.activeJob,
            waiter,
            new EngineCancelledError('Superseded by newer position from the same client session.')
          );
        }
      }
      if (this.activeJob.waiters.size === 0) {
        this.engineManager.abortActiveSearch(
          'Active job cancelled because its sole client submitted a newer position.'
        );
      }
    }
  }

  _settleWaiter(job, waiter, error, value = null) {
    if (waiter.settled) return;
    waiter.settled = true;
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
    job.waiters.delete(waiter);
    if (error) {
      waiter.reject(error);
    } else {
      waiter.resolve(value);
    }
  }

  /**
   * Submits an analysis request (JSON or SSE).
   * Returns a Promise resolving to `{ fen, sideToMove, bestmove, ponder, terminal, results, cached, deduplicated }`.
   */
  enqueue({
    fen,
    sideToMove,
    requestedDepths,
    clientSessionId = null,
    timeoutMs,
    onDepthSnapshot = null,
    signal = null,
  }) {
    if (signal?.aborted) {
      return Promise.reject(new EngineCancelledError('Client disconnected before queueing.'));
    }

    const sortedDepths = [...new Set(requestedDepths)].sort((a, b) => a - b);
    const maxDepth = sortedDepths[sortedDepths.length - 1];

    // Cancel any stale positions belonging to this client session before checking queue capacity
    if (clientSessionId) {
      this._cancelObsoleteClientRequests(clientSessionId, fen);
    }

    // Check bounded cache first
    const cached = this._getCached(fen, sortedDepths);
    if (cached) {
      if (typeof onDepthSnapshot === 'function') {
        for (const snap of cached.results) {
          onDepthSnapshot(snap);
        }
      }
      return Promise.resolve({
        ...cached,
        cached: true,
        deduplicated: false,
      });
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        id: crypto.randomUUID(),
        clientSessionId,
        requestedDepths: sortedDepths,
        requestedSet: new Set(sortedDepths),
        maxDepth,
        timeoutMs: timeoutMs === undefined ? this.config.engine.timeoutMs : timeoutMs,
        onDepthSnapshot,
        signal,
        onAbort: null,
        settled: false,
        resolve,
        reject,
      };

      // Deduplicate against active job if exact FEN matches and active search reaches >= maxDepth
      if (
        this.activeJob &&
        !this.activeJob.finished &&
        this.activeJob.fen === fen &&
        this.activeJob.targetDepth >= maxDepth
      ) {
        const job = this.activeJob;
        job.deduplicatedCount += 1;
        this._attachWaiterToJob(job, waiter, true);
        // Replay any already-captured snapshots for this waiter's requested depths
        for (const depth of sortedDepths) {
          const existingSnap = job.capturedSnapshots.get(depth);
          if (existingSnap && typeof waiter.onDepthSnapshot === 'function') {
            waiter.onDepthSnapshot(existingSnap);
          }
        }
        return;
      }

      // Deduplicate against an existing waiting job with the same FEN
      const existingQueuedIdx = this.waitingJobs.findIndex((j) => j.fen === fen);
      if (existingQueuedIdx !== -1) {
        const job = this.waitingJobs[existingQueuedIdx];
        job.targetDepth = Math.max(job.targetDepth, maxDepth);
        job.timeoutMs = Math.max(job.timeoutMs, waiter.timeoutMs);
        if (waiter.timeoutMs === 0) job.timeoutMs = 0;
        for (const d of sortedDepths) job.allRequestedDepths.add(d);
        job.deduplicatedCount += 1;
        job.updatedAt = Date.now();
        // Move updated job to the tail so it stays prioritized as latest
        this.waitingJobs.splice(existingQueuedIdx, 1);
        this.waitingJobs.push(job);
        this._attachWaiterToJob(job, waiter, true);
        return;
      }

      // Enforce bounded queue capacity
      if (this.waitingJobs.length >= this.config.engine.maxQueue) {
        reject(new QueueFullError(`Analysis queue is full (max ${this.config.engine.maxQueue} pending jobs).`));
        return;
      }

      const newJob = {
        id: crypto.randomUUID(),
        fen,
        sideToMove,
        targetDepth: maxDepth,
        allRequestedDepths: new Set(sortedDepths),
        timeoutMs: waiter.timeoutMs,
        waiters: new Set(),
        capturedSnapshots: new Map(),
        deduplicatedCount: 0,
        finished: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.waitingJobs.push(newJob);
      this._attachWaiterToJob(newJob, waiter, false);
      this._schedulePump();
    });
  }

  /**
   * Runs a custom async task serialized against regular engine searches using the same
   * single-process lock (`activeJob` / `waitingJobs`).
   */
  enqueueTask({ timeoutMs, signal = null, task }) {
    if (signal?.aborted) {
      return Promise.reject(new EngineCancelledError('Client disconnected before queueing.'));
    }
    if (typeof task !== 'function') {
      return Promise.reject(new Error('enqueueTask requires a task function.'));
    }

    return new Promise((resolve, reject) => {
      if (this.waitingJobs.length >= this.config.engine.maxQueue) {
        reject(new QueueFullError(`Analysis queue is full (max ${this.config.engine.maxQueue} pending jobs).`));
        return;
      }

      const waiter = {
        id: crypto.randomUUID(),
        clientSessionId: null,
        requestedDepths: [],
        requestedSet: new Set(),
        maxDepth: 0,
        timeoutMs: timeoutMs === undefined ? this.config.engine.timeoutMs : timeoutMs,
        onDepthSnapshot: null,
        signal,
        onAbort: null,
        settled: false,
        resolve,
        reject,
      };

      const newJob = {
        id: crypto.randomUUID(),
        fen: null,
        sideToMove: 'white',
        targetDepth: 0,
        allRequestedDepths: new Set(),
        timeoutMs: waiter.timeoutMs,
        waiters: new Set(),
        capturedSnapshots: new Map(),
        deduplicatedCount: 0,
        finished: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        customTask: task,
      };

      this.waitingJobs.push(newJob);
      this._attachWaiterToJob(newJob, waiter, false);
      this._schedulePump();
    });
  }

  _attachWaiterToJob(job, waiter, isDeduplicated) {
    waiter.isDeduplicated = isDeduplicated;
    job.waiters.add(waiter);

    if (waiter.signal) {
      waiter.onAbort = () => {
        this._settleWaiter(job, waiter, new EngineCancelledError('Client disconnected or aborted request.'));
        if (job.waiters.size === 0) {
          if (this.activeJob === job) {
            this.engineManager.abortActiveSearch('All attached clients disconnected.');
          } else {
            const idx = this.waitingJobs.indexOf(job);
            if (idx !== -1) this.waitingJobs.splice(idx, 1);
          }
        }
      };
      waiter.signal.addEventListener('abort', waiter.onAbort, { once: true });
    }
  }

  _schedulePump() {
    if (this.pumping || this.activeJob || this.waitingJobs.length === 0) return;
    this._pump().catch(() => {});
  }

  async _pump() {
    if (this.pumping || this.activeJob) return;
    if (this.waitingJobs.length === 0) return;

    this.pumping = true;
    try {
      while (this.waitingJobs.length > 0 && !this.activeJob) {
        // Latest-position-first scheduling: pop the newest queued job from the tail
        const job = this.waitingJobs.pop();
        if (!job || job.waiters.size === 0) continue;

        this.activeJob = job;

        // Compute effective timeout across attached waiters (0 means unbounded)
        let jobTimeout = 0;
        let hasUnbounded = false;
        for (const w of job.waiters) {
          if (w.timeoutMs === 0) {
            hasUnbounded = true;
            break;
          }
          jobTimeout = Math.max(jobTimeout, w.timeoutMs);
        }
        if (hasUnbounded) jobTimeout = 0;

        try {
          if (typeof job.customTask === 'function') {
            const customResult = await job.customTask({
              engineManager: this.engineManager,
              timeoutMs: jobTimeout,
            });
            job.finished = true;
            for (const waiter of [...job.waiters]) {
              this._settleWaiter(job, waiter, null, customResult);
            }
            continue;
          }

          const searchResult = await this.engineManager.analyze({
            fen: job.fen,
            sideToMove: job.sideToMove,
            targetDepth: job.targetDepth,
            requestedDepths: [...job.allRequestedDepths],
            timeoutMs: jobTimeout,
            onDepthSnapshot: (snap) => {
              job.capturedSnapshots.set(snap.depth, snap);
              for (const waiter of [...job.waiters]) {
                if (waiter.requestedSet.has(snap.depth) && typeof waiter.onDepthSnapshot === 'function') {
                  waiter.onDepthSnapshot(snap);
                }
              }
            },
          });

          job.finished = true;
          const resultsByDepth = new Map(searchResult.results.map((r) => [r.depth, r]));

          for (const waiter of [...job.waiters]) {
            const waiterResults = [];
            for (const d of waiter.requestedDepths) {
              const matched = resultsByDepth.get(d) || job.capturedSnapshots.get(d);
              if (matched) waiterResults.push(matched);
            }
            // Fallback for terminal positions (depth 0 / checkmate)
            if (waiterResults.length === 0 && searchResult.results.length > 0) {
              waiterResults.push(searchResult.results[searchResult.results.length - 1]);
            }

            const payload = {
              fen: job.fen,
              sideToMove: job.sideToMove,
              bestmove: searchResult.bestmove,
              ponder: searchResult.ponder,
              terminal: searchResult.terminal,
              results: waiterResults,
            };

            this._setCached(job.fen, waiter.requestedDepths, payload);
            this._settleWaiter(job, waiter, null, {
              ...payload,
              cached: false,
              deduplicated: waiter.isDeduplicated || job.deduplicatedCount > 0,
            });
          }
        } catch (err) {
          job.finished = true;
          for (const waiter of [...job.waiters]) {
            this._settleWaiter(job, waiter, err);
          }
        } finally {
          if (this.activeJob === job) {
            this.activeJob = null;
          }
        }
      }
    } finally {
      this.pumping = false;
      if (this.waitingJobs.length > 0 && !this.activeJob) {
        this._schedulePump();
      }
    }
  }

  cancelAll(reason = 'Server shutting down.') {
    for (const job of [...this.waitingJobs]) {
      for (const waiter of [...job.waiters]) {
        this._settleWaiter(job, waiter, new EngineCancelledError(reason));
      }
    }
    this.waitingJobs = [];
  }
}

module.exports = {
  RequestQueue,
  QueueFullError,
};
