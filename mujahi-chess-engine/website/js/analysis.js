/**
 * Live chess analysis page controller for MUJAHI static website.
 * Supports REST JSON (/v1/analyze) and progressive SSE (/v1/analyze/stream).
 */
(function initAnalysisPage() {
  'use strict';

  const PRESETS = {
    start: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sicilian: 'r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    endgame: '4k3/8/8/4P3/8/8/4K3/8 w - - 0 1',
    mate: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
  };

  const PIECE_UNICODE = {
    K: '♔',
    Q: '♕',
    R: '♖',
    B: '♗',
    N: '♘',
    P: '♙',
    k: '♚',
    q: '♛',
    r: '♜',
    b: '♝',
    n: '♞',
    p: '♟',
  };

  let activeController = null;

  function parseBoardSquares(fen) {
    const placement = String(fen || '').trim().split(/\s+/)[0] || '';
    const ranks = placement.split('/');
    if (ranks.length !== 8) return null;

    const board = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (const ch of ranks[r]) {
        if (/[1-8]/.test(ch)) {
          const empty = Number(ch);
          for (let i = 0; i < empty; i++) row.push('');
        } else if (PIECE_UNICODE[ch]) {
          row.push(ch);
        } else {
          return null;
        }
      }
      if (row.length !== 8) return null;
      board.push(row);
    }
    return board;
  }

  function squareIndexFromCoord(coord) {
    if (!coord || coord.length < 2) return null;
    const file = coord.charCodeAt(0) - 97;
    const rank = 8 - Number(coord[1]);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return `${rank}-${file}`;
  }

  function renderBoard(boardEl, fen, bestmove) {
    if (!boardEl) return;
    const board = parseBoardSquares(fen);
    boardEl.innerHTML = '';

    const fromKey = bestmove && bestmove !== '(none)' ? squareIndexFromCoord(bestmove.slice(0, 2)) : null;
    const toKey = bestmove && bestmove !== '(none)' ? squareIndexFromCoord(bestmove.slice(2, 4)) : null;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = document.createElement('div');
        const isLight = (r + f) % 2 === 0;
        const key = `${r}-${f}`;
        let classes = `square ${isLight ? 'square-light' : 'square-dark'}`;
        if (key === fromKey) classes += ' square-highlight-from';
        if (key === toKey) classes += ' square-highlight-to';
        sq.className = classes;

        const piece = board ? board[r][f] : '';
        if (piece) {
          const span = document.createElement('span');
          span.textContent = PIECE_UNICODE[piece];
          span.className = piece === piece.toUpperCase() ? 'piece-white' : 'piece-black';
          sq.appendChild(span);
        }

        if (r === 7 || f === 0) {
          const coord = document.createElement('span');
          coord.className = 'square-coord';
          coord.textContent = `${f === 0 ? 8 - r : ''}${r === 7 ? String.fromCharCode(97 + f) : ''}`;
          sq.appendChild(coord);
        }

        boardEl.appendChild(sq);
      }
    }
  }

  function formatEvalText(snapshot) {
    if (!snapshot) return '—';
    if (snapshot.mate !== null && snapshot.mate !== undefined) {
      return snapshot.mate > 0 ? `#${snapshot.mate}` : `#-${Math.abs(snapshot.mate)}`;
    }
    if (snapshot.evaluation !== null && snapshot.evaluation !== undefined) {
      const val = Number(snapshot.evaluation);
      return `${val >= 0 ? '+' : ''}${val.toFixed(2)}`;
    }
    return '—';
  }

  function updateEvalBar(fillEl, labelEl, snapshot) {
    if (!fillEl || !labelEl) return;
    let whitePct = 50;
    if (snapshot) {
      if (snapshot.mate !== null && snapshot.mate !== undefined) {
        whitePct = snapshot.mate > 0 ? 98 : 2;
      } else if (snapshot.evaluation !== null && snapshot.evaluation !== undefined) {
        const clamped = Math.max(-10, Math.min(10, Number(snapshot.evaluation)));
        whitePct = 50 + (clamped / 10) * 46;
      }
    }
    fillEl.style.height = `${Math.round(whitePct)}%`;
    labelEl.textContent = formatEvalText(snapshot);
  }

  function renderDepthSnapshots(listEl, resultsObj) {
    if (!listEl) return;
    const depths = Object.keys(resultsObj || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    if (depths.length === 0) {
      listEl.innerHTML = '<div class="notice">No depth snapshots yet.</div>';
      return;
    }

    listEl.innerHTML = '';
    for (const d of depths) {
      const snap = resultsObj[String(d)];
      const row = document.createElement('div');
      row.className = 'depth-row';
      row.innerHTML = `
        <div class="depth-row-top">
          <strong class="mono">Depth ${d}</strong>
          <span class="mono">Best: <strong>${snap.bestmove || '—'}</strong> · Eval (White POV): <strong>${formatEvalText(snap)}</strong></span>
          <span class="mono" style="color: var(--text-secondary); font-size: 12px;">
            ${snap.nodes ? `${Number(snap.nodes).toLocaleString()} nodes` : ''}
            ${snap.nps ? ` · ${Number(snap.nps).toLocaleString()} nps` : ''}
            ${snap.timeMs !== undefined ? ` · ${snap.timeMs} ms` : ''}
          </span>
        </div>
        <div class="depth-pv">${snap.continuation ? `PV: ${snap.continuation}` : 'No continuation line'}</div>
      `;
      listEl.appendChild(row);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('analysis-form');
    if (!form || !window.MujahiApiClient) return;

    const fenInput = document.getElementById('fen-input');
    const depthProfile = document.getElementById('depth-profile');
    const modeSelect = document.getElementById('transport-mode');
    const timeoutInput = document.getElementById('timeout-ms');
    const analyzeBtn = document.getElementById('analyze-submit-btn');
    const cancelBtn = document.getElementById('analyze-cancel-btn');
    const statusBox = document.getElementById('analysis-status-box');
    const boardEl = document.getElementById('chessboard');
    const evalFillEl = document.getElementById('eval-bar-fill');
    const evalLabelEl = document.getElementById('eval-bar-label');
    const metricBest = document.getElementById('metric-bestmove');
    const metricEval = document.getElementById('metric-eval');
    const metricLatency = document.getElementById('metric-latency');
    const metricState = document.getElementById('metric-state');
    const depthListEl = document.getElementById('depth-results-list');
    const rawJsonEl = document.getElementById('raw-response-json');

    renderBoard(boardEl, fenInput.value, null);

    fenInput.addEventListener('input', () => {
      renderBoard(boardEl, fenInput.value, null);
    });

    document.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        if (PRESETS[key]) {
          fenInput.value = PRESETS[key];
          renderBoard(boardEl, fenInput.value, null);
        }
      });
    });

    cancelBtn.addEventListener('click', () => {
      if (activeController) {
        activeController.abort();
        activeController = null;
        metricState.textContent = 'Cancelled';
        statusBox.className = 'notice';
        statusBox.textContent = 'Analysis request aborted by client.';
        analyzeBtn.disabled = false;
        cancelBtn.disabled = true;
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (activeController) {
        activeController.abort();
      }
      activeController = new AbortController();
      const { signal } = activeController;

      const fen = fenInput.value.trim();
      const depths = depthProfile.value
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      const transport = modeSelect.value;
      const timeoutMs = timeoutInput.value ? Number(timeoutInput.value) : undefined;

      analyzeBtn.disabled = true;
      cancelBtn.disabled = false;
      metricState.textContent = transport === 'stream' ? 'Streaming SSE...' : 'Running JSON...';
      metricBest.textContent = '—';
      metricEval.textContent = '—';
      metricLatency.textContent = '—';
      statusBox.className = 'notice';
      statusBox.textContent = 'Sending position to Stockfish 19 (sf_19) engine worker...';
      depthListEl.innerHTML = '<div class="notice">Waiting for engine depth snapshots...</div>';

      const liveResults = {};

      try {
        let response;
        if (transport === 'stream') {
          response = await window.MujahiApiClient.streamAnalyzePosition(
            {
              fen,
              depths,
              timeoutMs,
              onStarted: () => {
                statusBox.textContent = 'SSE stream open. Waiting for depth snapshots...';
              },
              onSnapshot: (snap) => {
                liveResults[String(snap.depth)] = snap;
                renderDepthSnapshots(depthListEl, liveResults);
                renderBoard(boardEl, fen, snap.bestmove);
                updateEvalBar(evalFillEl, evalLabelEl, snap);
                metricBest.textContent = snap.bestmove || '—';
                metricEval.textContent = formatEvalText(snap);
              },
            },
            { signal }
          );
        } else {
          response = await window.MujahiApiClient.analyzePosition(
            { fen, depths, timeoutMs },
            { signal }
          );
        }

        const { payload, latencyMs } = response;
        const resultKeys = Object.keys(payload.results || {}).map(Number).sort((a, b) => a - b);
        const highestSnap = resultKeys.length > 0 ? payload.results[String(resultKeys[resultKeys.length - 1])] : null;

        renderBoard(boardEl, payload.fen, payload.bestmove);
        updateEvalBar(evalFillEl, evalLabelEl, highestSnap);
        renderDepthSnapshots(depthListEl, payload.results);

        metricBest.textContent = payload.bestmove || '—';
        metricEval.textContent = formatEvalText(highestSnap);
        metricLatency.textContent = `${latencyMs} ms`;
        metricState.textContent = payload.cached ? 'Completed (Cache)' : 'Completed';
        statusBox.className = 'notice notice-ok';
        statusBox.textContent = `Stockfish ${payload.version || '19'} completed analysis${payload.deduplicated ? ' (deduplicated)' : ''}.`;
        rawJsonEl.textContent = JSON.stringify(payload, null, 2);
      } catch (err) {
        if (err.name === 'AbortError') return;
        metricState.textContent = err.code || 'Error';
        statusBox.className = 'notice notice-error';
        statusBox.textContent =
          err.message ||
          'Failed to reach the MUJAHI API. Confirm API_BASE_URL and verify Render instance status.';
        rawJsonEl.textContent = JSON.stringify(
          {
            error: {
              code: err.code || 'REQUEST_FAILED',
              status: err.status || 0,
              message: err.message,
              details: err.details || null,
            },
          },
          null,
          2
        );
      } finally {
        activeController = null;
        analyzeBtn.disabled = false;
        cancelBtn.disabled = true;
      }
    });
  });
})();
