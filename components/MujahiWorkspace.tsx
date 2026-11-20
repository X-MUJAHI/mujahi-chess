'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Cpu,
  FolderGit2,
  GitBranch,
  Layers,
  Puzzle,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import Navbar, { WorkspaceTab } from './Navbar';
import RepoExplorer, { RepoFileEntry } from './RepoExplorer';
import LiveApiConsole from './LiveApiConsole';

export default function MujahiWorkspace() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [explorerTarget, setExplorerTarget] = useState<string>('api/Dockerfile');
  const [files, setFiles] = useState<RepoFileEntry[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/repo')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to list monorepo');
        return data;
      })
      .then((data) => {
        if (active) setFiles(data.files || []);
      })
      .catch((err) => {
        if (active) setListError(err.message || 'Unable to read monorepo directory');
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const openFileInExplorer = (filePath: string) => {
    setExplorerTarget(filePath);
    setActiveTab('explorer');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F14] text-[#F1F5F9]">
      <Navbar activeTab={activeTab} onSelectTab={setActiveTab} fileCount={files.length} />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <section className="grid gap-6 border-b border-[#24303F] pb-8 lg:grid-cols-[1.25fr_0.75fr]">
                <div className="space-y-5">
                  <div className="font-mono text-xs font-semibold uppercase tracking-widest text-[#4ADE80]">
                    MUJAHI CHESS ENGINE API · GITHUB-READY MONOREPO
                  </div>
                  <h1
                    className="text-3xl font-extrabold tracking-tight text-[#F1F5F9] sm:text-5xl sm:leading-[1.08]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    Stockfish 19 hosting for Render, Vercel, and Chess Helper 2.1.0.
                  </h1>
                  <p className="max-w-2xl text-sm sm:text-base text-[#94A3B8]">
                    Built around pinned Stockfish 19 (<code className="font-mono text-[#E2E8F0]">sf_19</code>) with SFNNv16 neural evaluation, session-isolated latest-position-first scheduling, progressive SSE depth streaming, and semantic FEN protection.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab('explorer')}
                      className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-[#22C55E] px-4 text-sm font-semibold text-[#05130A] hover:bg-[#4ADE80]"
                    >
                      <FolderGit2 className="h-4 w-4" />
                      <span>Browse All Monorepo Files</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('console')}
                      className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-[#324256] bg-[#131920] px-4 text-sm font-semibold text-[#F1F5F9] hover:border-[#64748B]"
                    >
                      <span>Test Live Render API</span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <aside className="rounded-xl border border-[#24303F] bg-[#131920] p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[#F1F5F9]">Pinned Engine Manifest</h2>
                    <span className="font-mono text-xs text-[#4ADE80]">SFNNv16</span>
                  </div>
                  <dl className="divide-y divide-[#24303F] text-xs">
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-[#94A3B8]">Release Tag</dt>
                      <dd className="font-mono text-[#F1F5F9]">sf_19</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-[#94A3B8]">Commit SHA</dt>
                      <dd className="font-mono text-[#F1F5F9] truncate max-w-[190px]">
                        edb0d9db6731067ec50ce619ff372b463bc4dd5d
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-[#94A3B8]">Default NNUE</dt>
                      <dd className="font-mono text-[#F1F5F9]">nn-1a298aa575a0.nnue</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-[#94A3B8]">Target Arch</dt>
                      <dd className="font-mono text-[#F1F5F9]">x86-64-sse41-popcnt</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-[#94A3B8]">Node Runtime</dt>
                      <dd className="font-mono text-[#F1F5F9]">Node.js 24 LTS + Express</dd>
                    </div>
                  </dl>
                </aside>
              </section>

              <section className="grid gap-4 md:grid-cols-3">
                <article className="rounded-xl border border-[#24303F] bg-[#131920] p-5 space-y-2.5">
                  <Server className="h-5 w-5 text-[#4ADE80]" />
                  <h3 className="text-base font-bold text-[#F1F5F9]">Render Docker API (api/)</h3>
                  <p className="text-xs leading-relaxed text-[#94A3B8]">
                    Compiles Stockfish 19 from pinned commit, runs persistent UCI process with configurable timeouts, session-scoped cancellation, FEN deduplication, and REST + SSE routes.
                  </p>
                  <button
                    type="button"
                    onClick={() => openFileInExplorer('api/src/engine/manager.js')}
                    className="cursor-pointer font-mono text-xs text-[#4ADE80] hover:underline"
                  >
                    Inspect api/src/engine/manager.js →
                  </button>
                </article>

                <article className="rounded-xl border border-[#24303F] bg-[#131920] p-5 space-y-2.5">
                  <Layers className="h-5 w-5 text-[#4ADE80]" />
                  <h3 className="text-base font-bold text-[#F1F5F9]">Vercel Static Site (website/)</h3>
                  <p className="text-xs leading-relaxed text-[#94A3B8]">
                    Zero-framework plain HTML, CSS, and Vanilla JS across 5 pages with live SSE chessboard evaluation, API docs, status telemetry, and mobile-first styling.
                  </p>
                  <button
                    type="button"
                    onClick={() => openFileInExplorer('website/js/api-client.js')}
                    className="cursor-pointer font-mono text-xs text-[#4ADE80] hover:underline"
                  >
                    Inspect website/js/api-client.js →
                  </button>
                </article>

                <article className="rounded-xl border border-[#24303F] bg-[#131920] p-5 space-y-2.5">
                  <Puzzle className="h-5 w-5 text-[#4ADE80]" />
                  <h3 className="text-base font-bold text-[#F1F5F9]">Chess Helper 2.1.0 Adapter</h3>
                  <p className="text-xs leading-relaxed text-[#94A3B8]">
                    Preserves Hosted API (StockfishOnline) and Local WASM, adding MUJAHI API over an MV3 background service worker so Chess.com never depends on CORS.
                  </p>
                  <button
                    type="button"
                    onClick={() => openFileInExplorer('examples/extension-provider.js')}
                    className="cursor-pointer font-mono text-xs text-[#4ADE80] hover:underline"
                  >
                    Inspect examples/extension-provider.js →
                  </button>
                </article>
              </section>

              <section className="rounded-xl border border-[#24303F] bg-[#131920] p-5">
                <div className="mb-4 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[#4ADE80]" />
                  <h2 className="text-base font-bold text-[#F1F5F9]">Verified Quality &amp; Security Controls</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  <div className="rounded-lg border border-[#24303F] bg-[#080B0F] p-3.5">
                    <div className="font-semibold text-[#F1F5F9]">23/23 API Unit Tests</div>
                    <div className="mt-1 text-[#94A3B8]">
                      Covers FEN semantics, UCI parsing, LIFO session cancellation, deduplication, and SSE streaming.
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#24303F] bg-[#080B0F] p-3.5">
                    <div className="font-semibold text-[#F1F5F9]">Complete FEN Guardrails</div>
                    <div className="mt-1 text-[#94A3B8]">
                      Rejects newline injection, missing/adjacent kings, check legality errors, and illegal en passant before stdin.
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#24303F] bg-[#080B0F] p-3.5">
                    <div className="font-semibold text-[#F1F5F9]">Strict CORS Allowlist</div>
                    <div className="mt-1 text-[#94A3B8]">
                      Allows only your Vercel origin; browser extension routes through MV3 host_permissions.
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#24303F] bg-[#080B0F] p-3.5">
                    <div className="font-semibold text-[#F1F5F9]">GPL-3.0 + MIT Split</div>
                    <div className="mt-1 text-[#94A3B8]">
                      Includes verbatim Stockfish GPL-3.0, reproducible build provenance, and MIT wrapper license.
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'explorer' && (
            <RepoExplorer
              files={files}
              loadingList={loadingList}
              listError={listError}
              initialFile={explorerTarget}
            />
          )}

          {activeTab === 'console' && <LiveApiConsole />}

          {activeTab === 'extension' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-[#24303F] bg-[#131920] p-5">
                <h2 className="text-lg font-bold text-[#F1F5F9]">
                  Chess Helper 2.1.0 (SuperMode) Multi-Provider Integration
                </h2>
                <p className="mt-2 text-sm text-[#94A3B8]">
                  Targets Chess Helper 2.1.0&apos;s <code className="font-mono text-[#E2E8F0]">#ch-engine-settings-overlay</code> provider switcher. Existing <code className="font-mono text-[#E2E8F0]">api</code> (StockfishOnline) and <code className="font-mono text-[#E2E8F0]">wasm</code> (Stockfish 19 Lite) modes remain intact while <code className="font-mono text-[#4ADE80]">mujahi</code> runs over an MV3 background service worker.
                </p>

                <div className="mt-4 overflow-x-auto rounded-lg border border-[#24303F]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#19212B] font-mono uppercase text-[#94A3B8]">
                      <tr>
                        <th className="px-4 py-2.5">Provider</th>
                        <th className="px-4 py-2.5">Transport</th>
                        <th className="px-4 py-2.5">Output Contract</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#24303F] bg-[#080B0F] text-[#CBD5E1]">
                      <tr>
                        <td className="px-4 py-3 font-mono">api (default)</td>
                        <td className="px-4 py-3">StockfishOnline HTTPS GET</td>
                        <td className="px-4 py-3 font-mono">{'{ move, evaluation, mate, continuation, depth, raw }'}</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">wasm</td>
                        <td className="px-4 py-3">extension/engine/host.html Worker</td>
                        <td className="px-4 py-3 font-mono">{'{ move, evaluation, mate, continuation, depth, raw }'}</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-[#4ADE80]">mujahi (added)</td>
                        <td className="px-4 py-3">MV3 Service Worker SSE → Render Docker</td>
                        <td className="px-4 py-3 font-mono">{'{ move, evaluation, mate, continuation, depth, raw }'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openFileInExplorer('examples/extension-background.js')}
                    className="cursor-pointer rounded-md border border-[#324256] bg-[#0B0F14] px-3.5 py-2 font-mono text-xs text-[#F1F5F9] hover:border-[#22C55E]"
                  >
                    View examples/extension-background.js
                  </button>
                  <button
                    type="button"
                    onClick={() => openFileInExplorer('examples/extension-provider.js')}
                    className="cursor-pointer rounded-md border border-[#324256] bg-[#0B0F14] px-3.5 py-2 font-mono text-xs text-[#F1F5F9] hover:border-[#22C55E]"
                  >
                    View examples/extension-provider.js
                  </button>
                  <button
                    type="button"
                    onClick={() => openFileInExplorer('docs/EXTENSION-INTEGRATION.md')}
                    className="cursor-pointer rounded-md border border-[#324256] bg-[#0B0F14] px-3.5 py-2 font-mono text-xs text-[#F1F5F9] hover:border-[#22C55E]"
                  >
                    View docs/EXTENSION-INTEGRATION.md
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'deployment' && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-[#24303F] bg-[#131920] p-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#F1F5F9]">
                    <Cpu className="h-4 w-4 text-[#4ADE80]" />
                    <span>1. Render.com Docker Backend (api/)</span>
                  </div>
                  <ul className="list-disc space-y-1.5 pl-4 text-xs text-[#94A3B8]">
                    <li>
                      Set <strong className="text-[#E2E8F0]">Root Directory</strong> to{' '}
                      <code className="font-mono text-[#E2E8F0]">api</code> and{' '}
                      <strong className="text-[#E2E8F0]">Runtime</strong> to <code className="font-mono text-[#E2E8F0]">Docker</code>.
                    </li>
                    <li>
                      Set <strong className="text-[#E2E8F0]">Health Check Path</strong> to{' '}
                      <code className="font-mono text-[#E2E8F0]">/health</code>.
                    </li>
                    <li>
                      Free tier (<code className="font-mono">0.1 vCPU / 512 MB</code>) works for testing with cold-start sleep; Starter (<code className="font-mono">0.5 vCPU / 512 MB</code>) is recommended for consistent play.
                    </li>
                    <li>
                      Run <code className="font-mono text-[#E2E8F0]">npm run bench</code> via container shell/CI to inspect real hardware NPS and wall-clock latency.
                    </li>
                  </ul>
                </div>

                <div className="rounded-xl border border-[#24303F] bg-[#131920] p-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#F1F5F9]">
                    <GitBranch className="h-4 w-4 text-[#4ADE80]" />
                    <span>2. Vercel Static Frontend (website/)</span>
                  </div>
                  <ul className="list-disc space-y-1.5 pl-4 text-xs text-[#94A3B8]">
                    <li>
                      Update <code className="font-mono text-[#E2E8F0]">website/config.js</code> with your Render URL via GitHub web editor.
                    </li>
                    <li>
                      Set Vercel <strong className="text-[#E2E8F0]">Root Directory</strong> to{' '}
                      <code className="font-mono text-[#E2E8F0]">website</code> and Framework Preset to <code className="font-mono text-[#E2E8F0]">Other</code>.
                    </li>
                    <li>
                      Add the resulting Vercel domain to <code className="font-mono text-[#E2E8F0]">CORS_ALLOWED_ORIGINS</code> on Render.
                    </li>
                  </ul>
                </div>
              </div>

              <div className="rounded-xl border border-[#24303F] bg-[#131920] p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Terminal className="h-5 w-5 text-[#4ADE80]" />
                  <div>
                    <div className="text-sm font-semibold text-[#F1F5F9]">Full Web-Dashboard Guide &amp; CI Workflow</div>
                    <div className="text-xs text-[#94A3B8]">
                      Step-by-step instructions requiring zero local PC terminal.
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openFileInExplorer('docs/DEPLOYMENT.md')}
                    className="cursor-pointer rounded-md bg-[#22C55E] px-3.5 py-2 text-xs font-semibold text-[#05130A] hover:bg-[#4ADE80]"
                  >
                    Open docs/DEPLOYMENT.md
                  </button>
                  <button
                    type="button"
                    onClick={() => openFileInExplorer('.github/workflows/ci.yml')}
                    className="cursor-pointer rounded-md border border-[#324256] bg-[#0B0F14] px-3.5 py-2 font-mono text-xs text-[#F1F5F9] hover:border-[#64748B]"
                  >
                    Open .github/workflows/ci.yml
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
