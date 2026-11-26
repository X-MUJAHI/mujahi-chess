'use client';

import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, ExternalLink, Save } from 'lucide-react';
import type { DownloadConfig } from '@/lib/store';

const ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  'X-Requested-With': 'MujahiAdmin',
};

export default function AdminDownloadEditor({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('Download Mujahi Chess');
  const [version, setVersion] = useState('v2.1.0');
  const [fileSize, setFileSize] = useState('Chrome & Lemur MV3');
  const [notes, setNotes] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/download-config', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) {
          if (active) onUnauthorized();
          return null;
        }
        const data: DownloadConfig & { error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load download config');
        return data;
      })
      .then((data) => {
        if (!active || !data) return;
        setUrl(data.url || '');
        setLabel(data.label || 'Download Mujahi Chess');
        setVersion(data.version || 'v2.1.0');
        setFileSize(data.fileSize || 'Chrome & Lemur MV3');
        setNotes(data.notes || '');
        setUpdatedAt(data.updatedAt || null);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load download settings');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedOk(false);
    setError(null);

    try {
      const res = await fetch('/api/admin/download-config', {
        method: 'PUT',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ url, label, version, fileSize, notes }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to save download config');
      setUrl(data.url || '');
      setLabel(data.label || 'Download Mujahi Chess');
      setVersion(data.version || 'v2.1.0');
      setFileSize(data.fileSize || 'Chrome & Lemur MV3');
      setNotes(data.notes || '');
      setUpdatedAt(data.updatedAt || null);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const isUrlReady = Boolean(url.trim() && /^https?:\/\//i.test(url.trim()));

  if (loading) {
    return (
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-3">
        <div className="h-6 w-48 rounded bg-[#F3F4F6]" />
        <div className="h-10 rounded bg-[#F3F4F6]" />
        <div className="h-10 rounded bg-[#F3F4F6]" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-6">
        <div className="mb-5 border-b border-[#E5E7EB] pb-4">
          <h2
            className="text-base font-bold text-[#111827]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Public Download Link Configuration
          </h2>
          <p className="mt-1 text-xs text-[#6B7280]">
            Changes saved here immediately update the primary Download button on the public landing page.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">
              Download URL (https:// or http://)
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mujahi-chess-v2.1.0.zip"
              className="h-10 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-3 font-mono text-xs text-[#111827] placeholder-[#9CA3AF] focus:border-[#14532D] focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-[#6B7280]">
              Leave blank to show a polite pending state on the public page until your release file is uploaded.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#374151]">
                Button Label
              </label>
              <input
                type="text"
                maxLength={60}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                className="h-10 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-3 text-xs text-[#111827] focus:border-[#14532D] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#374151]">
                Version Tag
              </label>
              <input
                type="text"
                maxLength={24}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
                className="h-10 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-3 font-mono text-xs text-[#111827] focus:border-[#14532D] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">
              Package Target / Subtitle
            </label>
            <input
              type="text"
              maxLength={40}
              value={fileSize}
              onChange={(e) => setFileSize(e.target.value)}
              className="h-10 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-3 text-xs text-[#111827] focus:border-[#14532D] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">
              Release / Install Summary
            </label>
            <textarea
              rows={3}
              maxLength={280}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] p-3 text-xs leading-relaxed text-[#111827] focus:border-[#14532D] focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-md border border-[#DC2626]/30 bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#B91C1C]">
              {error}
            </div>
          )}

          {savedOk && (
            <div className="flex items-center gap-2 rounded-md border border-[#15803D]/30 bg-[#ECFDF5] px-3.5 py-2.5 text-xs font-medium text-[#14532D]">
              <Check className="h-4 w-4" />
              <span>Public download configuration updated.</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className="font-mono text-[11px] text-[#6B7280]">
              {updatedAt ? `Last updated ${new Date(updatedAt).toLocaleString()}` : ''}
            </span>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-[#14532D] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#15803D] disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Saving...' : 'Save Download Settings'}</span>
            </button>
          </div>
        </form>
      </section>

      <aside className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-4 self-start">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#111827]">Live Landing Button Preview</h3>
          <span
            className={`font-mono text-xs font-semibold ${
              isUrlReady ? 'text-[#16A34A]' : 'text-[#D97706]'
            }`}
          >
            {isUrlReady ? 'LINK ACTIVE' : 'NO URL SET'}
          </span>
        </div>

        <div className="rounded-lg border border-[#E5E7EB] bg-[#FAF9F6] p-5 space-y-4">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#15803D]">
            RELEASE {version || 'v2.1.0'} · {fileSize || 'Chrome & Lemur MV3'}
          </div>
          <p className="text-xs leading-relaxed text-[#4B5563]">
            {notes || 'No install notes entered.'}
          </p>

          {isUrlReady ? (
            <a
              href={url.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#14532D] px-5 text-sm font-semibold text-white hover:bg-[#15803D]"
            >
              <ArrowDownToLine className="h-4 w-4" />
              <span>{label || 'Download Mujahi Chess'}</span>
              <ArrowUpRight className="h-4 w-4 opacity-80" />
            </a>
          ) : (
            <div className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#14532D]/85 px-5 text-sm font-semibold text-white">
              <ArrowDownToLine className="h-4 w-4" />
              <span>{label || 'Download Mujahi Chess'}</span>
            </div>
          )}

          {isUrlReady && (
            <div className="flex items-center gap-1.5 truncate font-mono text-[11px] text-[#6B7280]">
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{url.trim()}</span>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
