'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Crown,
  Download,
  Eye,
  EyeOff,
  FolderGit2,
  KeyRound,
  Lock,
  LogOut,
  Menu,
  Terminal,
  X,
} from 'lucide-react';
import AdminDownloadEditor from './AdminDownloadEditor';
import AdminKeyManager from './AdminKeyManager';
import LiveApiConsole from './LiveApiConsole';
import RepoExplorer, { RepoFileEntry } from './RepoExplorer';

type AdminTab = 'keys' | 'download' | 'console' | 'repo';

const TAB_ITEMS: { id: AdminTab; label: string; icon: typeof KeyRound }[] = [
  { id: 'keys', label: 'License Keys', icon: KeyRound },
  { id: 'download', label: 'Download Link', icon: Download },
  { id: 'console', label: 'Live API Console', icon: Terminal },
  { id: 'repo', label: 'Repository Viewer', icon: FolderGit2 },
];

export default function AdminPortal({ initialAuthenticated }: { initialAuthenticated: boolean }) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('keys');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [repoFiles, setRepoFiles] = useState<RepoFileEntry[]>([]);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoLoadedOnce, setRepoLoadedOnce] = useState(false);
  const repoLoading = authenticated && activeTab === 'repo' && !repoLoadedOnce && !repoError;

  const handleUnauthorized = useCallback(() => {
    setAuthenticated(false);
    setRepoLoadedOnce(false);
    setRepoFiles([]);
    setAuthError('Your admin session expired. Sign in again to continue.');
  }, []);

  useEffect(() => {
    if (!authenticated || activeTab !== 'repo' || repoLoadedOnce) return;
    let active = true;

    fetch('/api/repo', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) {
          if (active) handleUnauthorized();
          return null;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load repository files');
        return data;
      })
      .then((data) => {
        if (!active || !data) return;
        setRepoError(null);
        setRepoFiles(data.files || []);
        setRepoLoadedOnce(true);
      })
      .catch((err) => {
        if (active) setRepoError(err instanceof Error ? err.message : 'Unable to read repository');
      });

    return () => {
      active = false;
    };
  }, [authenticated, activeTab, repoLoadedOnce, handleUnauthorized]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'MujahiAdmin',
        },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAuthError(data?.error || 'Authentication failed.');
        return;
      }
      setPassword('');
      setAuthenticated(true);
    } catch {
      setAuthError('Network error reaching authentication endpoint.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/admin/auth', {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'MujahiAdmin' },
      });
    } catch {
      // Clear local UI state regardless
    }
    setAuthenticated(false);
    setRepoLoadedOnce(false);
    setRepoFiles([]);
    setPassword('');
    setAuthError(null);
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-7 sm:p-8"
        >
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[#14532D]/20 bg-[#ECFDF5] text-[#14532D]">
              <Lock className="h-4 w-4" />
            </span>
            <div>
              <div
                className="text-base font-bold text-[#111827]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Mujahi Chess Admin
              </div>
              <div className="text-xs text-[#6B7280]">Restricted management portal</div>
            </div>
          </div>

          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label htmlFor="admin-password" className="mb-1.5 block text-xs font-semibold text-[#374151]">
                Admin Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Enter admin password"
                  className="h-10 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] pl-3 pr-10 text-sm text-[#111827] placeholder-[#9CA3AF] focus:border-[#14532D] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-[#6B7280] hover:text-[#111827]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {authError && (
              <div className="rounded-md border border-[#DC2626]/30 bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#B91C1C]">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={signingIn}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[#14532D] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#15803D] disabled:opacity-50"
            >
              <span>{signingIn ? 'Verifying...' : 'Unlock Admin Panel'}</span>
            </button>
          </form>

          <div className="mt-6 border-t border-[#E5E7EB] pt-4 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4B5563] hover:text-[#111827]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Return to Mujahi Chess</span>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  const activeMeta = TAB_ITEMS.find((t) => t.id === activeTab) || TAB_ITEMS[0];

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#111827]">
      <header className="sticky top-0 z-40 border-b border-[#E5E7EB] bg-white">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[#E5E7EB] text-[#111827] lg:hidden"
              aria-label="Toggle admin sidebar"
            >
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>

            <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#14532D]/20 bg-[#ECFDF5] text-[#14532D]">
                <Crown className="h-3.5 w-3.5" />
              </span>
              <span className="font-bold text-[#111827] whitespace-nowrap" style={{ fontFamily: 'var(--font-display)' }}>
                Mujahi Chess
              </span>
              <span className="text-[#9CA3AF]">/</span>
              <span className="hidden text-[#6B7280] sm:inline whitespace-nowrap">Admin Panel</span>
              <span className="hidden text-[#9CA3AF] sm:inline">/</span>
              <span className="truncate font-semibold text-[#14532D]">{activeMeta.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-3 text-xs font-medium text-[#374151] hover:border-[#14532D] hover:text-[#111827] whitespace-nowrap"
            >
              <span>Public Site</span>
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#DC2626]/30 bg-[#FEF2F2] px-3 text-xs font-medium text-[#B91C1C] hover:bg-[#FEE2E2] whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside
          className={`${
            mobileNavOpen ? 'fixed inset-y-14 left-0 z-30 block' : 'hidden'
          } w-60 shrink-0 border-r border-[#E5E7EB] bg-white p-4 lg:static lg:block`}
        >
          <div className="mb-3 px-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Operations
          </div>
          <nav className="space-y-1" aria-label="Admin sections">
            {TAB_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileNavOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-[#14532D] text-white'
                      : 'text-[#374151] hover:bg-[#FAF9F6] hover:text-[#111827]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
            >
              {activeTab === 'keys' && <AdminKeyManager onUnauthorized={handleUnauthorized} />}
              {activeTab === 'download' && (
                <AdminDownloadEditor onUnauthorized={handleUnauthorized} />
              )}
              {activeTab === 'console' && <LiveApiConsole />}
              {activeTab === 'repo' && (
                <RepoExplorer
                  files={repoFiles}
                  loadingList={repoLoading}
                  listError={repoError}
                />
              )}
            </motion.div>
          </div>
        </main>
      </div>
    </div>
  );
}
