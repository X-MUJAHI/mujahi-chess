'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Crown,
  Layers,
  Menu,
  RefreshCw,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import type { DownloadConfig } from '@/lib/store';

interface LandingPageProps {
  initialConfig: DownloadConfig;
}

export default function LandingPage({ initialConfig }: LandingPageProps) {
  const [config, setConfig] = useState<DownloadConfig>(initialConfig);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingNotice, setPendingNotice] = useState(false);

  // Interactive extension-panel preview controls (no chessboard)
  const [autoPlayOn, setAutoPlayOn] = useState(false);
  const [superModeOn, setSuperModeOn] = useState(true);
  const [showD15, setShowD15] = useState(true);
  const [showD10, setShowD10] = useState(true);
  const [showD5, setShowD5] = useState(false);
  const [softChip, setSoftChip] = useState<string>('c3 (-0.28)');

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

  const renderDownloadAction = (variant: 'nav' | 'hero' | 'footer') => {
    const labelText = config.label || 'Download Mujahi Chess';
    const baseClasses =
      variant === 'nav'
        ? 'inline-flex h-9 items-center gap-2 rounded-xl bg-[#81B64C] px-4 text-xs font-bold text-[#121212] shadow-[0_4px_15px_rgba(129,182,76,0.35)] transition-all hover:bg-[#A3D160] hover:-translate-y-0.5 whitespace-nowrap shrink-0 cursor-pointer'
        : 'inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-[#81B64C] px-6 text-sm font-bold text-[#121212] shadow-[0_6px_22px_rgba(129,182,76,0.4)] transition-all hover:bg-[#A3D160] hover:-translate-y-0.5 whitespace-nowrap shrink-0 cursor-pointer';

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
          {variant !== 'nav' && <ArrowUpRight className="h-4 w-4" />}
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
    <div className="min-h-screen flex flex-col bg-[#0C0C0F] text-white selection:bg-[#81B64C]/30 selection:text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#121215]/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <a
            href="#top"
            className="flex items-center gap-2.5 text-left font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-[#81B64C]/15 text-[#81B64C]">
              <Crown className="h-4 w-4" />
            </span>
            <span className="text-base" style={{ fontFamily: 'var(--font-display)' }}>
              Mujahi Chess
            </span>
          </a>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Primary navigation">
            <a
              href="#features"
              className="text-sm font-medium text-[#A1A1AA] transition-colors hover:text-white whitespace-nowrap"
            >
              Capabilities
            </a>
            <a
              href="#how-it-works"
              className="text-sm font-medium text-[#A1A1AA] transition-colors hover:text-white whitespace-nowrap"
            >
              How It Works
            </a>
            <a
              href="#setup"
              className="text-sm font-medium text-[#A1A1AA] transition-colors hover:text-white whitespace-nowrap"
            >
              Browser Setup
            </a>
          </nav>

          <div className="flex items-center gap-2">
            {renderDownloadAction('nav')}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white md:hidden"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav className="flex flex-col gap-1 border-t border-white/10 bg-[#121215] px-4 py-3 md:hidden">
            <a
              href="#features"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-[#A1A1AA] hover:bg-white/5 hover:text-white"
            >
              Capabilities
            </a>
            <a
              href="#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-[#A1A1AA] hover:bg-white/5 hover:text-white"
            >
              How It Works
            </a>
            <a
              href="#setup"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-[#A1A1AA] hover:bg-white/5 hover:text-white"
            >
              Browser Setup
            </a>
          </nav>
        )}
      </header>

      <main id="top" className="flex-1">
        <section className="relative overflow-hidden border-b border-white/10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#81B64C]/12 blur-[110px]"
          />

          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#81B64C]">
                RELEASE {config.version || 'v2.1.0'} · {config.fileSize || 'CHROME & LEMUR MV3'}
              </div>

              <h1
                className="font-extrabold tracking-tight text-white"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(2.25rem, 4.2vw, 3.65rem)',
                  lineHeight: 1.07,
                }}
              >
                Floating panel clarity built for natural play.
              </h1>

              <p className="max-w-xl text-base leading-relaxed text-[#A1A1AA] sm:text-lg">
                Mujahi Chess puts live multi-depth calculations, SuperMode insights, and
                subtle human-style alternatives inside a compact frosted-glass control panel
                built for desktop and mobile browsers.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                {renderDownloadAction('hero')}
                <a
                  href="#setup"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10 whitespace-nowrap"
                >
                  Installation Guide
                </a>
              </div>

              {pendingNotice && !hasValidDownloadUrl && (
                <div className="rounded-xl border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-4 py-3 text-sm text-[#FDE68A]">
                  The latest release link is being updated. Check back shortly for the direct
                  package download.
                </div>
              )}

              <div className="grid max-w-lg grid-cols-3 gap-6 border-t border-white/10 pt-6 text-xs">
                <div>
                  <div className="font-semibold text-white">Desktop &amp; Mobile</div>
                  <div className="mt-1 text-[#A1A1AA]">Chromium &amp; Lemur Browser</div>
                </div>
                <div>
                  <div className="font-semibold text-white">Soft Mistake Finder</div>
                  <div className="mt-1 text-[#A1A1AA]">Compact top-dock picks</div>
                </div>
                <div>
                  <div className="font-semibold text-white">Multi-Depth Control</div>
                  <div className="mt-1 text-[#A1A1AA]">Independent D5 / D10 / D15</div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 }}
              className="mx-auto w-full max-w-[350px] rounded-[20px] border border-white/10 bg-[#121214]/90 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-md"
            >
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="text-base font-bold tracking-tight text-white">
                  Chess Assist <span className="text-[11px] font-normal text-[#A1A1AA]">by Mujahi</span>
                </div>
                <div className="flex items-center gap-2 text-[#A1A1AA]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                    <Settings className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-white">Auto-play move</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoPlayOn}
                    onClick={() => setAutoPlayOn((v) => !v)}
                    className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${
                      autoPlayOn ? 'bg-[#81B64C]' : 'bg-white/10'
                    }`}
                  >
                    <span
                      className={`inline-block h-[18px] w-[18px] rounded-full bg-white transition-transform ${
                        autoPlayOn ? 'translate-x-[23px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-[10px] border border-[#82AEF5]/25 bg-[#5A82D2]/10 px-3 py-2">
                  <div>
                    <div className="text-[11px] font-bold text-[#DBEAFE]">SuperMode Overlays</div>
                    <div className="text-[10px] text-[#A1A1AA]">Live highlights &amp; quick dock</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={superModeOn}
                    onClick={() => setSuperModeOn((v) => !v)}
                    className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors ${
                      superModeOn ? 'bg-[#81B64C]' : 'bg-white/15'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                        superModeOn ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </button>
                </div>

                <div className="rounded-[12px] border border-white/[0.06] bg-black/25 p-3 space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#A1A1AA]">
                    Depth Channels
                  </div>

                  {[
                    { label: 'D 15', color: '#4ADE80', on: showD15, toggle: () => setShowD15((v) => !v) },
                    { label: 'D 10', color: '#2DD4BF', on: showD10, toggle: () => setShowD10((v) => !v) },
                    { label: 'D 05', color: '#38BDF8', on: showD5, toggle: () => setShowD5((v) => !v) },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: row.color }}
                        />
                        <span className="font-mono text-xs text-[#E4E4E7]">{row.label}</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.on}
                        onClick={row.toggle}
                        className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors ${
                          row.on ? 'bg-[#81B64C]' : 'bg-white/10'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                            row.on ? 'translate-x-[18px]' : 'translate-x-[3px]'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="rounded-[10px] border border-[#F59E0B]/25 bg-[#F59E0B]/[0.07] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.04em] text-[#FDE68A]">
                      Soft Mistakes (-0.25 to -0.85)
                    </span>
                    <span className="rounded-md border border-[#F59E0B]/40 bg-[#F59E0B]/20 px-2 py-0.5 text-[10px] font-bold text-[#FEF3C7]">
                      Find
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {['c3 (-0.28)', 'Be2 (-0.41)', 'a3 (-0.64)'].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setSoftChip(chip)}
                        className={`cursor-pointer rounded-md border px-2 py-1 font-mono text-[10px] font-semibold transition-colors ${
                          softChip === chip
                            ? 'border-[#F59E0B] bg-[#F59E0B]/25 text-white'
                            : 'border-[#F59E0B]/25 bg-white/5 text-[#E4E4E7] hover:bg-[#F59E0B]/15'
                        }`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-white/10 pt-3 text-xs">
                  <span className="font-semibold text-[#FFD700]">Human Style</span>
                  <span className="font-mono text-[11px] text-[#A1A1AA]">
                    {superModeOn ? 'Panel Ready' : 'Standby'}
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-10 max-w-2xl space-y-3">
            <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#81B64C]">
              CORE CAPABILITIES
            </div>
            <h2
              className="text-2xl font-bold tracking-tight text-white sm:text-4xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Built around the floating Chess Assist panel.
            </h2>
            <p className="text-sm leading-relaxed text-[#A1A1AA] sm:text-base">
              Every toggle, depth channel, and quick-dock suggestion stays within one tap
              while keeping your screen clean and responsive.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-[20px] border border-white/10 bg-[#141417]/85 p-6 backdrop-blur-md md:col-span-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[#81B64C]">01.</span>
                <Layers className="h-5 w-5 text-[#81B64C]" />
              </div>
              <h3
                className="mt-4 text-xl font-bold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Frosted Glass Control Panel
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#A1A1AA]">
                Toggle independent D5, D10, and D15 calculation lines, configure natural
                auto-play timing, and dock or minimize the floating bubble cleanly anywhere
                on screen.
              </p>
            </article>

            <article className="rounded-[20px] border border-white/10 bg-[#141417]/85 p-6 backdrop-blur-md">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[#81B64C]">02.</span>
                <Sparkles className="h-5 w-5 text-[#F59E0B]" />
              </div>
              <h3
                className="mt-4 text-lg font-bold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Subtle Alternative Finder
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">
                Surfaces plausible, low-drop alternatives from a slim fixed top dock—tap any
                candidate chip to inspect or play it immediately.
              </p>
            </article>

            <article className="rounded-[20px] border border-white/10 bg-[#141417]/85 p-6 backdrop-blur-md">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[#81B64C]">03.</span>
                <SlidersHorizontal className="h-5 w-5 text-[#A5C7FF]" />
              </div>
              <h3
                className="mt-4 text-lg font-bold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                SuperMode Insights
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">
                Enable selective evaluation bars, blunder alerts, and expected reply hints
                inside a clean collapsible settings sheet.
              </p>
            </article>

            <article className="rounded-[20px] border border-white/10 bg-[#141417]/85 p-6 backdrop-blur-md md:col-span-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[#81B64C]">04.</span>
                <Shield className="h-5 w-5 text-[#81B64C]" />
              </div>
              <h3
                className="mt-4 text-xl font-bold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Desktop &amp; Mobile Chromium Ready
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#A1A1AA]">
                Packaged for strict Manifest V3 policies so it installs cleanly on desktop
                Chrome, Edge, and mobile Lemur Browser with reliable background engine routing.
              </p>
            </article>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-white/10 bg-[#121215]/70">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="mb-10 max-w-2xl space-y-2">
              <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#81B64C]">
                WORKFLOW
              </div>
              <h2
                className="text-2xl font-bold tracking-tight text-white sm:text-3xl"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Ready in three quick steps.
              </h2>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                <div className="font-mono text-xs font-semibold text-[#81B64C]">STEP 01</div>
                <h3 className="mt-2 text-base font-bold text-white">Download the Package</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#A1A1AA]">
                  Use the Download button to grab the latest release archive and extract it
                  into a folder on your device.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                <div className="font-mono text-xs font-semibold text-[#81B64C]">STEP 02</div>
                <h3 className="mt-2 text-base font-bold text-white">Load Unpacked Extension</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#A1A1AA]">
                  Open Extensions, enable Developer Mode, and select the extracted folder in
                  Chrome, Edge, or Lemur Browser.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                <div className="font-mono text-xs font-semibold text-[#81B64C]">STEP 03</div>
                <h3 className="mt-2 text-base font-bold text-white">Open the Floating Panel</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#A1A1AA]">
                  Tap the floating icon, pick your analysis mode and depth settings, or activate
                  an extended session key inside Get Moves.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="setup" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="rounded-[20px] border border-white/10 bg-[#141417]/90 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)] sm:p-10">
            <div className="grid items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#81B64C]">
                  <Shield className="h-4 w-4" />
                  <span>CURRENT PACKAGE</span>
                </div>
                <h2
                  className="text-2xl font-bold tracking-tight text-white sm:text-3xl"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Install Mujahi Chess {config.version || 'v2.1.0'}
                </h2>
                <p className="text-sm leading-relaxed text-[#A1A1AA]">
                  {config.notes ||
                    'Unzip the archive and load it in Developer Mode on Chromium desktop browsers or Lemur Browser on Android.'}
                </p>

                <ul className="space-y-2 pt-1 text-sm text-[#E4E4E7]">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-[#81B64C]" />
                    <span>Manifest V3 compliant for Chrome, Edge, and Lemur Browser</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-[#81B64C]" />
                    <span>Instant key activation inside the Get Moves panel</span>
                  </li>
                </ul>
              </div>

              <div className="flex flex-col items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-6 lg:items-stretch">
                <div className="flex w-full items-center justify-between gap-4 text-xs text-[#A1A1AA]">
                  <span>Release Version</span>
                  <span className="font-mono font-semibold text-white">
                    {config.version || 'v2.1.0'}
                  </span>
                </div>
                <div className="flex w-full items-center justify-between gap-4 border-b border-white/10 pb-2 text-xs text-[#A1A1AA]">
                  <span>Package Target</span>
                  <span className="font-mono font-semibold text-white">
                    {config.fileSize || 'Chrome & Lemur MV3'}
                  </span>
                </div>
                <div className="flex w-full flex-col pt-1">{renderDownloadAction('footer')}</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#0C0C0F]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 text-xs text-[#A1A1AA] sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-2 font-semibold text-white">
            <Crown className="h-4 w-4 text-[#81B64C]" />
            <span style={{ fontFamily: 'var(--font-display)' }}>Mujahi Chess</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <a href="#features" className="hover:text-white">
              Capabilities
            </a>
            <a href="#how-it-works" className="hover:text-white">
              How It Works
            </a>
            <a href="#setup" className="hover:text-white">
              Setup
            </a>
          </div>
          <div>© {new Date().getFullYear()} Mujahi Chess. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
