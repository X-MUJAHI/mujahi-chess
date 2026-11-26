'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Compass,
  Crown,
  Layers,
  Menu,
  Shield,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import type { DownloadConfig } from '@/lib/store';

interface LandingPageProps {
  initialConfig: DownloadConfig;
}

interface BoardScenario {
  id: 'sicilian' | 'italian';
  name: string;
  fen: string;
  bestMoveLabel: string;
  bestEval: string;
  bestSquares: { from: string; to: string };
  bestNote: string;
  subtleMoveLabel: string;
  subtleEval: string;
  subtleSquares: { from: string; to: string };
  subtleNote: string;
}

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

const SCENARIOS: BoardScenario[] = [
  {
    id: 'sicilian',
    name: 'Sicilian Defense',
    fen: 'r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    bestMoveLabel: 'Bb5',
    bestEval: '+0.42',
    bestSquares: { from: 'f1', to: 'b5' },
    bestNote: 'Rossolimo pressure with clean piece development and central control.',
    subtleMoveLabel: 'c3',
    subtleEval: '+0.14',
    subtleSquares: { from: 'c2', to: 'c3' },
    subtleNote: 'Natural positional buildup that stays balanced while keeping plans simple.',
  },
  {
    id: 'italian',
    name: 'Italian Game',
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    bestMoveLabel: 'c3',
    bestEval: '+0.35',
    bestSquares: { from: 'c2', to: 'c3' },
    bestNote: 'Prepares d4 expansion with classical central grip.',
    subtleMoveLabel: 'd3',
    subtleEval: '+0.12',
    subtleSquares: { from: 'd2', to: 'd3' },
    subtleNote: 'Calm Giuoco Pianissimo line with low tactical risk.',
  },
];

function parseFenBoard(fen: string): string[][] {
  const placement = fen.split(' ')[0] || '';
  return placement.split('/').map((rank) => {
    const row: string[] = [];
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < Number(ch); i += 1) row.push('');
      } else {
        row.push(ch);
      }
    }
    return row;
  });
}

function algebraicFromRowCol(row: number, col: number): string {
  const file = String.fromCharCode(97 + col);
  const rank = String(8 - row);
  return `${file}${rank}`;
}

export default function LandingPage({ initialConfig }: LandingPageProps) {
  const [config, setConfig] = useState<DownloadConfig>(initialConfig);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingNotice, setPendingNotice] = useState(false);

  const [scenarioId, setScenarioId] = useState<'sicilian' | 'italian'>('sicilian');
  const [previewMode, setPreviewMode] = useState<'best' | 'subtle'>('best');

  useEffect(() => {
    let active = true;
    const refresh = () => {
      fetch('/api/download-config', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: DownloadConfig | null) => {
          if (active && data && typeof data.label === 'string') {
            setConfig(data);
          }
        })
        .catch(() => {
          // Keep SSR config if offline.
        });
    };

    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const hasValidDownloadUrl = Boolean(config.url && /^https?:\/\//i.test(config.url));
  const activeScenario = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
  const board = parseFenBoard(activeScenario.fen);
  const activeSquares =
    previewMode === 'best' ? activeScenario.bestSquares : activeScenario.subtleSquares;

  const renderDownloadAction = (variant: 'nav' | 'hero' | 'footer') => {
    const labelText = config.label || 'Download Mujahi Chess';
    const baseClasses =
      variant === 'nav'
        ? 'inline-flex h-9 items-center gap-2 rounded-md bg-[#14532D] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#15803D] whitespace-nowrap shrink-0 cursor-pointer'
        : 'inline-flex h-12 items-center justify-center gap-2.5 rounded-md bg-[#14532D] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#15803D] whitespace-nowrap shrink-0 cursor-pointer';

    if (hasValidDownloadUrl) {
      return (
        <a
          href={config.url}
          target="_blank"
          rel="noopener noreferrer"
          className={baseClasses}
        >
          <ArrowDownToLine className={variant === 'nav' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          <span>{variant === 'nav' ? 'Download' : labelText}</span>
          {variant !== 'nav' && <ArrowUpRight className="h-4 w-4 opacity-80" />}
        </a>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setPendingNotice(true)}
        className={baseClasses}
      >
        <ArrowDownToLine className={variant === 'nav' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        <span>{variant === 'nav' ? 'Download' : labelText}</span>
      </button>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#111827]">
      <header className="sticky top-0 z-40 border-b border-[#E5E7EB] bg-[#FAF9F6]/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <a
            href="#top"
            className="flex items-center gap-2.5 text-left font-bold tracking-tight text-[#111827] whitespace-nowrap shrink-0"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[#14532D]/20 bg-[#ECFDF5] text-[#14532D]">
              <Crown className="h-4 w-4" />
            </span>
            <span className="text-base" style={{ fontFamily: 'var(--font-display)' }}>
              Mujahi Chess
            </span>
          </a>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Primary navigation">
            <a
              href="#features"
              className="text-sm font-medium text-[#4B5563] transition-colors hover:text-[#111827] whitespace-nowrap"
            >
              Capabilities
            </a>
            <a
              href="#how-it-works"
              className="text-sm font-medium text-[#4B5563] transition-colors hover:text-[#111827] whitespace-nowrap"
            >
              How It Works
            </a>
            <a
              href="#setup"
              className="text-sm font-medium text-[#4B5563] transition-colors hover:text-[#111827] whitespace-nowrap"
            >
              Browser Setup
            </a>
          </nav>

          <div className="flex items-center gap-2">
            {renderDownloadAction('nav')}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#111827] md:hidden"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav className="flex flex-col gap-1 border-t border-[#E5E7EB] bg-[#FAF9F6] px-4 py-3 md:hidden">
            <a
              href="#features"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-sm font-medium text-[#4B5563] hover:bg-white hover:text-[#111827]"
            >
              Capabilities
            </a>
            <a
              href="#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-sm font-medium text-[#4B5563] hover:bg-white hover:text-[#111827]"
            >
              How It Works
            </a>
            <a
              href="#setup"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-sm font-medium text-[#4B5563] hover:bg-white hover:text-[#111827]"
            >
              Browser Setup
            </a>
          </nav>
        )}
      </header>

      <main id="top" className="flex-1">
        <section className="border-b border-[#E5E7EB]">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.12fr_0.88fr] lg:py-20">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28 }}
              className="space-y-6"
            >
              <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#15803D]">
                RELEASE {config.version || 'v2.1.0'} · {config.fileSize || 'CHROME & LEMUR MV3'}
              </div>

              <h1
                className="font-extrabold tracking-tight text-[#111827]"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(2.25rem, 4.2vw, 3.65rem)',
                  lineHeight: 1.07,
                }}
              >
                Clear board analysis built for natural play.
              </h1>

              <p className="max-w-xl text-base leading-relaxed text-[#4B5563] sm:text-lg">
                Mujahi Chess reads live board positions right inside your browser, drawing crisp
                move arrows, adjustable evaluation depth, and subtle human-paced alternatives
                without getting in your way.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                {renderDownloadAction('hero')}
                <a
                  href="#setup"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-[#D1D5DB] bg-white px-5 text-sm font-semibold text-[#111827] transition-colors hover:border-[#14532D] hover:text-[#14532D] whitespace-nowrap"
                >
                  Installation Guide
                </a>
              </div>

              {pendingNotice && !hasValidDownloadUrl && (
                <div className="rounded-md border border-[#D97706]/30 bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]">
                  The latest release link is being updated. Check back shortly for the direct
                  package download.
                </div>
              )}

              <div className="grid max-w-lg grid-cols-3 gap-6 border-t border-[#E5E7EB] pt-6 text-xs">
                <div>
                  <div className="font-semibold text-[#111827]">Desktop &amp; Mobile</div>
                  <div className="mt-1 text-[#6B7280]">Chromium &amp; Lemur Browser</div>
                </div>
                <div>
                  <div className="font-semibold text-[#111827]">Subtle Alternatives</div>
                  <div className="mt-1 text-[#6B7280]">Natural move finder</div>
                </div>
                <div>
                  <div className="font-semibold text-[#111827]">One-Tap Dock</div>
                  <div className="mt-1 text-[#6B7280]">Compact screen controls</div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: 0.06 }}
              className="rounded-xl border border-[#E5E7EB] bg-white p-5 sm:p-6"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3.5">
                <div className="flex items-center gap-2">
                  {SCENARIOS.map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setScenarioId(sc.id)}
                      className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        scenarioId === sc.id
                          ? 'bg-[#14532D] text-white'
                          : 'bg-[#F3F4F6] text-[#4B5563] hover:text-[#111827]'
                      }`}
                    >
                      {sc.name}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-[#FAF9F6] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('best')}
                    className={`cursor-pointer rounded px-2.5 py-1 font-medium transition-colors ${
                      previewMode === 'best'
                        ? 'bg-white text-[#14532D] shadow-xs'
                        : 'text-[#6B7280] hover:text-[#111827]'
                    }`}
                  >
                    Best Line
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('subtle')}
                    className={`cursor-pointer rounded px-2.5 py-1 font-medium transition-colors ${
                      previewMode === 'subtle'
                        ? 'bg-white text-[#B45309] shadow-xs'
                        : 'text-[#6B7280] hover:text-[#111827]'
                    }`}
                  >
                    Natural Alt
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-8 aspect-square w-full overflow-hidden rounded-lg border border-[#D1D5DB]">
                {board.map((row, rIdx) =>
                  row.map((piece, cIdx) => {
                    const isLight = (rIdx + cIdx) % 2 === 0;
                    const sq = algebraicFromRowCol(rIdx, cIdx);
                    const isTarget = sq === activeSquares.to;
                    const isOrigin = sq === activeSquares.from;

                    const highlightClass =
                      previewMode === 'best'
                        ? isTarget
                          ? 'ring-2 ring-inset ring-[#14532D] bg-[#86EFAC]/55'
                          : isOrigin
                            ? 'ring-2 ring-inset ring-[#15803D] bg-[#BBF7D0]/55'
                            : ''
                        : isTarget
                          ? 'ring-2 ring-inset ring-[#B45309] bg-[#FDE68A]/70'
                          : isOrigin
                            ? 'ring-2 ring-inset ring-[#D97706] bg-[#FEF3C7]/75'
                            : '';

                    return (
                      <div
                        key={sq}
                        className={`flex items-center justify-center text-2xl sm:text-[30px] select-none transition-colors ${
                          isLight ? 'bg-[#F3F1EA]' : 'bg-[#7A9A7E]'
                        } ${highlightClass}`}
                      >
                        {piece && (
                          <span
                            className={
                              piece === piece.toUpperCase()
                                ? 'text-white drop-shadow-[0_1px_2px_rgba(17,24,39,0.75)]'
                                : 'text-[#111827]'
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

              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-[#FAF9F6] px-3.5 py-2.5">
                <div>
                  <div className="text-xs font-medium text-[#6B7280]">
                    {previewMode === 'best' ? 'Recommended Continuation' : 'Human-Style Alternative'}
                  </div>
                  <div className="mt-0.5 text-xs text-[#374151]">
                    {previewMode === 'best' ? activeScenario.bestNote : activeScenario.subtleNote}
                  </div>
                </div>
                <div className="shrink-0 text-right font-mono">
                  <div
                    className={`text-sm font-bold ${
                      previewMode === 'best' ? 'text-[#14532D]' : 'text-[#B45309]'
                    }`}
                  >
                    {previewMode === 'best'
                      ? activeScenario.bestMoveLabel
                      : activeScenario.subtleMoveLabel}
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    {previewMode === 'best' ? activeScenario.bestEval : activeScenario.subtleEval}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-10 max-w-2xl space-y-3">
            <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#15803D]">
              CORE CAPABILITIES
            </div>
            <h2
              className="text-2xl font-bold tracking-tight text-[#111827] sm:text-4xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Engine clarity without cluttering your board.
            </h2>
            <p className="text-sm leading-relaxed text-[#4B5563] sm:text-base">
              Every control is tuned to keep focus on the chessboard while giving you full
              command over calculation mode, move style, and screen ergonomics.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-xl border border-[#E5E7EB] bg-white p-6 md:col-span-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[#15803D]">01.</span>
                <Compass className="h-5 w-5 text-[#14532D]" />
              </div>
              <h3
                className="mt-4 text-xl font-bold text-[#111827]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Non-Intrusive Live Board Overlays
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#4B5563]">
                Draws clean directional arrows and square highlights directly over the board as
                positions update. Switch between compact top-dock suggestions or full depth views
                without blocking squares you need to click.
              </p>
            </article>

            <article className="rounded-xl border border-[#E5E7EB] bg-white p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[#15803D]">02.</span>
                <Sparkles className="h-5 w-5 text-[#14532D]" />
              </div>
              <h3
                className="mt-4 text-lg font-bold text-[#111827]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Subtle Alternative Finder
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                Surfaces plausible, low-loss candidate moves right from a compact top bar—tap any
                suggestion to inspect or play it immediately.
              </p>
            </article>

            <article className="rounded-xl border border-[#E5E7EB] bg-white p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[#15803D]">03.</span>
                <Layers className="h-5 w-5 text-[#14532D]" />
              </div>
              <h3
                className="mt-4 text-lg font-bold text-[#111827]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Flexible Analysis Providers
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                Run fast local evaluation right on your device or switch to high-depth remote
                analysis whenever you want deeper tactical lines.
              </p>
            </article>

            <article className="rounded-xl border border-[#E5E7EB] bg-white p-6 md:col-span-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[#15803D]">04.</span>
                <SlidersHorizontal className="h-5 w-5 text-[#14532D]" />
              </div>
              <h3
                className="mt-4 text-xl font-bold text-[#111827]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Built for Desktop &amp; Mobile Chromium Browsers
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#4B5563]">
                Engineered around strict Manifest V3 content policies so it installs cleanly on
                desktop Chrome, Edge, and mobile Lemur Browser with reliable worker isolation.
              </p>
            </article>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-[#E5E7EB] bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="mb-10 max-w-2xl space-y-2">
              <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#15803D]">
                WORKFLOW
              </div>
              <h2
                className="text-2xl font-bold tracking-tight text-[#111827] sm:text-3xl"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                From download to your first analyzed game in two minutes.
              </h2>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-lg border border-[#E5E7EB] bg-[#FAF9F6] p-5">
                <div className="font-mono text-xs font-semibold text-[#14532D]">STEP 01</div>
                <h3 className="mt-2 text-base font-bold text-[#111827]">Download the Package</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
                  Use the Download button to grab the latest verified extension archive and extract
                  it into a folder on your device.
                </p>
              </div>

              <div className="rounded-lg border border-[#E5E7EB] bg-[#FAF9F6] p-5">
                <div className="font-mono text-xs font-semibold text-[#14532D]">STEP 02</div>
                <h3 className="mt-2 text-base font-bold text-[#111827]">Load Unpacked Extension</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
                  Open Extensions, enable Developer Mode, and select the extracted folder in Chrome,
                  Edge, or Lemur Browser.
                </p>
              </div>

              <div className="rounded-lg border border-[#E5E7EB] bg-[#FAF9F6] p-5">
                <div className="font-mono text-xs font-semibold text-[#14532D]">STEP 03</div>
                <h3 className="mt-2 text-base font-bold text-[#111827]">Choose Your Mode</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
                  Open your board, pick your preferred analysis mode in settings, and toggle overlays
                  or key access whenever needed.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="setup" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="rounded-xl border border-[#14532D]/20 bg-white p-6 sm:p-10">
            <div className="grid items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#15803D]">
                  <Shield className="h-4 w-4" />
                  <span>CURRENT PACKAGE</span>
                </div>
                <h2
                  className="text-2xl font-bold tracking-tight text-[#111827] sm:text-3xl"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Ready to install Mujahi Chess {config.version || 'v2.1.0'}?
                </h2>
                <p className="text-sm leading-relaxed text-[#4B5563]">
                  {config.notes ||
                    'Unzip the archive and load it in Developer Mode on Chromium desktop browsers or Lemur Browser on Android.'}
                </p>

                <ul className="space-y-2 pt-1 text-sm text-[#374151]">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-[#15803D]" />
                    <span>Manifest V3 compliant with isolated local engine fallback</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-[#15803D]" />
                    <span>Compatible with license keys for extended sessions</span>
                  </li>
                </ul>
              </div>

              <div className="flex flex-col items-start gap-3 rounded-lg border border-[#E5E7EB] bg-[#FAF9F6] p-6 lg:items-stretch">
                <div className="flex items-center justify-between gap-4 text-xs text-[#6B7280] w-full">
                  <span>Release Version</span>
                  <span className="font-mono font-semibold text-[#111827]">
                    {config.version || 'v2.1.0'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-xs text-[#6B7280] w-full pb-2 border-b border-[#E5E7EB]">
                  <span>Package Target</span>
                  <span className="font-mono font-semibold text-[#111827]">
                    {config.fileSize || 'Chrome & Lemur MV3'}
                  </span>
                </div>
                <div className="pt-1 w-full flex flex-col">{renderDownloadAction('footer')}</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E5E7EB] bg-[#FAF9F6]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 text-xs text-[#6B7280] sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-2 font-semibold text-[#111827]">
            <Crown className="h-4 w-4 text-[#14532D]" />
            <span style={{ fontFamily: 'var(--font-display)' }}>Mujahi Chess</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <a href="#features" className="hover:text-[#111827]">
              Capabilities
            </a>
            <a href="#how-it-works" className="hover:text-[#111827]">
              How It Works
            </a>
            <a href="#setup" className="hover:text-[#111827]">
              Setup
            </a>
          </div>
          <div>© {new Date().getFullYear()} Mujahi Chess. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
