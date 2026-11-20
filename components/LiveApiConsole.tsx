'use client';

import { useMemo, useRef, useState } from 'react';
import { Activity, Play, Square, Wifi } from 'lucide-react';

const PRESET_FENS: { label: string; fen: string }[] = [
  { label: 'Start', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  {
    label: 'Sicilian',
    fen: 'r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  },
  { label: 'KP Endgame', fen: '4k3/8/8/4P3/8/8/4K3/8 w - - 0 1' },
  { label: 'Back-Rank Mate', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1' },
];

const PIECE_UNICODE: Record<string, string> = {
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

interface DepthSnapshot {
  depth: number;
  bestmove: string;
  evaluation: number | null;
  mate: number | null;
  continuation: string;
  nodes?: number;
  nps?: number;
  timeMs?: number;
}

function parseBoard(fen: string): string[][] | null {
  const placement = fen.trim().split(/\s+/)[0] || '';
  const ranks = placement.split('/');
  if (ranks.length !== 8) return null;
  const grid: string[][] = [];
  for (const rank of ranks) {
    const row: string[] = [];
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push('');
      } else if (PIECE_UNICODE[ch]) {
        row.push(ch);
      } else {
        return null;
      }
    }
    if (row.length !== 8) return null;
    grid.push(row);
  }
  return grid;
}

function squareKey(coord: string | null | undefined): string | null {
  if (!coord || coord.length < 2) return null;
  const file = coord.charCodeAt(0) - 97;
  const rank = 8 - Number(coord[1]);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${rank}-${file}`;
}

function formatEval(snap: DepthSnapshot | null): string {
  if (!snap) return '—';
  if (snap.mate !== null && snap.mate !== undefined) {
    return snap.mate > 0 ? `#${snap.mate}` : `#-${Math.abs(snap.mate)}`;
  }
  if (snap.evaluation !== null && snap.evaluation !== undefined) {
    return `${snap.evaluation >= 0 ? '+' : ''}${snap.evaluation.toFixed(2)}`;
  }
  return '—';
}

export default function LiveApiConsole() {
  const [apiUrl, setApiUrl] = useState('https://mujahi-chess.onrender.com');
  const [fen, setFen] = useState(PRESET_FENS[0].fen);
  const [depthsStr, setDepthsStr] = useState('5,10,15');
  const [transport, setTransport] = useState<'stream' | 'json'>('stream');
  const [timeoutMs, setTimeoutMs] = useState('45000');

  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    'Enter your deployed Render service URL above to test /health, /v1/analyze, or /v1/analyze/stream live.'
  );
  const [statusTone, setStatusTone] = useState<'neutral' | 'ok' | 'error'>('neutral');
  const [snapshots, setSnapshots] = useState<Record<string, DepthSnapshot>>({});
  const [bestmove, setBestmove] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [rawJson, setRawJson] = useState<string>('{}');

  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>('');

  const getSessionId = () => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = `preview_${Date.now().toString(36)}`;
    }
    return sessionIdRef.current;
  };

  const board = useMemo(() => parseBoard(fen), [fen]);
  const fromSq = squareKey(bestmove && bestmove !== '(none)' ? bestmove.slice(0, 2) : null);
  const toSq = squareKey(bestmove && bestmove !== '(none)' ? bestmove.slice(2, 4) : null);

  const sortedDepths = useMemo(
    () =>
      Object.keys(snapshots)
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b),
    [snapshots]
  );

  const highestSnap =
    sortedDepths.length > 0 ? snapshots[String(sortedDepths[sortedDepths.length - 1])] : null;

  const cleanBase = apiUrl.trim().replace(/\/+$/, '');

  const handleHealthCheck = async () => {
    if (!cleanBase) return;
    setStatusTone('neutral');
    setStatusMessage(`Probing ${cleanBase}/health ...`);
    const started = performance.now();
    try {
      const res = await fetch(`${cleanBase}/health`, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => null);
      setLatencyMs(Math.round(performance.now() - started));
      setRawJson(JSON.stringify(data, null, 2));
      if (!res.ok) {
        setStatusTone('error');
        setStatusMessage(`Backend responded HTTP ${res.status}.`);
        return;
      }
      setStatusTone('ok');
      setStatusMessage(
        `Backend online: ${data?.engine?.version || 'Stockfish 19'} (${data?.engine?.state || 'ready'})`
      );
    } catch (err) {
      setStatusTone('error');
      setStatusMessage(
        err instanceof Error
          ? `Network/CORS error reaching ${cleanBase}/health: ${err.message}`
          : 'Unable to reach backend.'
      );
    }
  };

  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setRunning(false);
    setStatusTone('neutral');
    setStatusMessage('Analysis aborted by client.');
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanBase) return;
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setSnapshots({});
    setBestmove(null);
    setLatencyMs(null);
    setStatusTone('neutral');
    setStatusMessage(
      transport === 'stream'
        ? `Opening SSE stream to ${cleanBase}/v1/analyze/stream ...`
        : `Posting JSON request to ${cleanBase}/v1/analyze ...`
    );

    const depths = depthsStr
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    const started = performance.now();

    try {
      const sid = getSessionId();
      const bodyPayload = {
        fen: fen.trim(),
        depths,
        clientSessionId: sid,
        timeoutMs: Number(timeoutMs) || 45000,
      };

      if (transport === 'json') {
        const res = await fetch(`${cleanBase}/v1/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Client-Session-Id': sid,
          },
          body: JSON.stringify(bodyPayload),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        setLatencyMs(Math.round(performance.now() - started));
        setRawJson(JSON.stringify(data, null, 2));
        if (!res.ok) {
          throw new Error(data?.error?.message || `HTTP ${res.status}`);
        }
        setSnapshots(data.results || {});
        setBestmove(data.bestmove || null);
        setStatusTone('ok');
        setStatusMessage(`Completed JSON analysis (${data.version || 'Stockfish 19'}).`);
      } else {
        const res = await fetch(`${cleanBase}/v1/analyze/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'X-Client-Session-Id': sid,
          },
          body: JSON.stringify(bodyPayload),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          throw new Error(errJson?.error?.message || `HTTP ${res.status}`);
        }
        if (!res.body) throw new Error('ReadableStream unavailable.');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            let eventType = 'message';
            const dataLines: string[] = [];
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            if (dataLines.length === 0) continue;
            const parsed = JSON.parse(dataLines.join('\n'));
            if (eventType === 'snapshot') {
              setSnapshots((prev) => ({ ...prev, [String(parsed.depth)]: parsed }));
              if (parsed.bestmove) setBestmove(parsed.bestmove);
            } else if (eventType === 'complete') {
              setSnapshots(parsed.results || {});
              setBestmove(parsed.bestmove || null);
              setLatencyMs(Math.round(performance.now() - started));
              setRawJson(JSON.stringify(parsed, null, 2));
              setStatusTone('ok');
              setStatusMessage(`SSE stream complete (${parsed.version || 'Stockfish 19'}).`);
            } else if (eventType === 'error') {
              throw new Error(parsed?.error?.message || 'SSE error');
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setStatusTone('error');
      setStatusMessage(
        err instanceof Error
          ? `${err.message} (Check Render service status and CORS_ALLOWED_ORIGINS)`
          : 'Request failed'
      );
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      <div className="rounded-xl border border-[#24303F] bg-[#131920] p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://mujahi-chess.onrender.com"
            aria-label="Render API Base URL"
            className="h-9 flex-1 rounded-md border border-[#324256] bg-[#080B0F] px-3 font-mono text-xs text-[#F1F5F9] focus:border-[#22C55E] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleHealthCheck}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-[#324256] bg-[#19212B] px-3 text-xs font-medium text-[#F1F5F9] hover:border-[#64748B]"
          >
            <Wifi className="h-3.5 w-3.5 text-[#4ADE80]" />
            <span>Probe /health</span>
          </button>
        </div>

        <div className="grid grid-cols-8 aspect-square w-full overflow-hidden rounded-md border border-[#324256]">
          {Array.from({ length: 8 }).map((_, r) =>
            Array.from({ length: 8 }).map((__, f) => {
              const isLight = (r + f) % 2 === 0;
              const key = `${r}-${f}`;
              const piece = board ? board[r][f] : '';
              const highlight =
                key === toSq
                  ? 'ring-2 ring-inset ring-[#4ADE80] bg-[#22C55E]/35'
                  : key === fromSq
                    ? 'ring-2 ring-inset ring-[#22C55E] bg-[#22C55E]/20'
                    : '';
              return (
                <div
                  key={key}
                  className={`flex items-center justify-center text-2xl sm:text-3xl select-none ${
                    isLight ? 'bg-[#CBD5E1]' : 'bg-[#475569]'
                  } ${highlight}`}
                >
                  {piece && (
                    <span
                      className={
                        piece === piece.toUpperCase()
                          ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
                          : 'text-[#0B0F14]'
                      }
                    >
                      {PIECE_UNICODE[piece]}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PRESET_FENS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setFen(preset.fen)}
              className="cursor-pointer rounded-md border border-[#324256] bg-[#0B0F14] px-2.5 py-1 text-xs text-[#CBD5E1] hover:border-[#22C55E] hover:text-white"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleAnalyze} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#94A3B8]">FEN String</label>
            <input
              type="text"
              value={fen}
              onChange={(e) => setFen(e.target.value)}
              required
              className="h-9 w-full rounded-md border border-[#324256] bg-[#080B0F] px-3 font-mono text-xs text-[#F1F5F9] focus:border-[#22C55E] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#94A3B8]">Depths</label>
              <select
                value={depthsStr}
                onChange={(e) => setDepthsStr(e.target.value)}
                className="h-9 w-full rounded-md border border-[#324256] bg-[#080B0F] px-2.5 font-mono text-xs text-[#F1F5F9]"
              >
                <option value="5,10,15">5,10,15 (Multi)</option>
                <option value="10">10 (Single)</option>
                <option value="15">15 (Single)</option>
                <option value="5,10,15,18">5,10,15,18</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#94A3B8]">Transport</label>
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as 'stream' | 'json')}
                className="h-9 w-full rounded-md border border-[#324256] bg-[#080B0F] px-2.5 text-xs text-[#F1F5F9]"
              >
                <option value="stream">SSE Stream</option>
                <option value="json">JSON POST</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#94A3B8]">Timeout (ms)</label>
            <input
              type="number"
              min={1000}
              max={180000}
              step={1000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(e.target.value)}
              className="h-9 w-full rounded-md border border-[#324256] bg-[#080B0F] px-3 font-mono text-xs text-[#F1F5F9]"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={running}
              className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md bg-[#22C55E] px-4 text-xs font-semibold text-[#05130A] hover:bg-[#4ADE80] disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{running ? 'Analyzing...' : 'Analyze Position'}</span>
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={!running}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-[#F87171]/40 bg-[#F87171]/10 px-3 text-xs font-medium text-[#F87171] disabled:opacity-40"
            >
              <Square className="h-3.5 w-3.5" />
              <span>Stop</span>
            </button>
          </div>
        </form>
      </div>

      <div className="space-y-4">
        <div
          className={`rounded-lg border px-4 py-3 text-xs ${
            statusTone === 'ok'
              ? 'border-[#22C55E]/40 bg-[#22C55E]/10 text-[#DCFCE7]'
              : statusTone === 'error'
                ? 'border-[#F87171]/40 bg-[#F87171]/10 text-[#FECACA]'
                : 'border-[#24303F] bg-[#131920] text-[#94A3B8]'
          }`}
        >
          {statusMessage}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-[#24303F] bg-[#131920] p-3.5">
            <div className="text-xs text-[#94A3B8]">Best Move</div>
            <div className="mt-1 font-mono text-lg font-bold text-[#F1F5F9]">
              {bestmove || '—'}
            </div>
          </div>
          <div className="rounded-xl border border-[#24303F] bg-[#131920] p-3.5">
            <div className="text-xs text-[#94A3B8]">Eval (White POV)</div>
            <div className="mt-1 font-mono text-lg font-bold text-[#4ADE80]">
              {formatEval(highestSnap)}
            </div>
          </div>
          <div className="rounded-xl border border-[#24303F] bg-[#131920] p-3.5">
            <div className="text-xs text-[#94A3B8]">Latency</div>
            <div className="mt-1 font-mono text-lg font-bold text-[#F1F5F9]">
              {latencyMs !== null ? `${latencyMs} ms` : '—'}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#24303F] bg-[#131920] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#F1F5F9]">
            <Activity className="h-4 w-4 text-[#4ADE80]" />
            <span>Progressive Depth Snapshots</span>
          </div>
          {sortedDepths.length === 0 ? (
            <div className="rounded-md border border-[#24303F] bg-[#080B0F] p-3 text-xs text-[#94A3B8]">
              Snapshots from your Render Stockfish 19 container will stream here.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedDepths.map((d) => {
                const s = snapshots[String(d)];
                return (
                  <div
                    key={d}
                    className="rounded-md border border-[#24303F] bg-[#080B0F] p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-[#4ADE80]">Depth {d}</span>
                      <span className="font-mono text-[#F1F5F9]">
                        {s.bestmove} · {formatEval(s)}
                      </span>
                      <span className="font-mono text-[#94A3B8]">
                        {s.nps ? `${s.nps.toLocaleString()} nps` : ''}
                      </span>
                    </div>
                    {s.continuation && (
                      <div className="mt-1.5 font-mono text-[11px] text-[#94A3B8]">
                        PV: {s.continuation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#24303F] bg-[#131920] p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
            Raw JSON Payload
          </div>
          <pre className="max-h-56 overflow-auto rounded-md border border-[#24303F] bg-[#080B0F] p-3 font-mono text-xs text-[#CBD5E1]">
            {rawJson}
          </pre>
        </div>
      </div>
    </div>
  );
}
