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
      <div className="rounded-[20px] border border-white/10 bg-[#141417]/90 p-6 space-y-3">
        <div className="h-6 w-48 rounded-lg bg-white/5" />
        <div className="h-10 rounded-lg bg-white/5" />
        <div className="h-10 rounded-lg bg-white/5" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-[20px] border border-white/10 bg-[#141417]/90 p-6 backdrop-blur-md">
        <div className="mb-5 border-b border-white/10 pb-4">
          <h2
            className="text-base font-bold text-white"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Public Download Link Configuration
          </h2>
          <p className="mt-1 text-xs text-[#A1A1AA]">
            Changes saved here immediately update the primary Download button on the public landing page.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#E4E4E7]">
              Download URL (https:// or http://)
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mujahi-chess-v2.1.0.zip"
              className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-xs text-white placeholder-[#71717A] focus:border-[#81B64C] focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-[#A1A1AA]">
              Leave blank to show a polite pending state on the public page until your release file is uploaded.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#E4E4E7]">
                Button Label
              </label>
              <input
                type="text"
                maxLength={60}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white focus:border-[#81B64C] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#E4E4E7]">
                Version Tag
              </label>
              <input
                type="text"
                maxLength={24}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
                className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-xs text-white focus:border-[#81B64C] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#E4E4E7]">
              Package Target / Subtitle
            </label>
            <input
              type="text"
              maxLength={40}
              value={fileSize}
              onChange={(e) => setFileSize(e.target.value)}
              className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white focus:border-[#81B64C] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#E4E4E7]">
              Release / Install Summary
            </label>
            <textarea
              rows={3}
              maxLength={280}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-white focus:border-[#81B64C] focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-[#F87171]/35 bg-[#F87171]/10 px-3.5 py-2.5 text-xs text-[#FECACA]">
              {error}
            </div>
          )}

          {savedOk && (
            <div className="flex items-center gap-2 rounded-lg border border-[#81B64C]/35 bg-[#81B64C]/15 px-3.5 py-2.5 text-xs font-medium text-[#A3D160]">
              <Check className="h-4 w-4" />
              <span>Public download configuration updated.</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className="font-mono text-[11px] text-[#A1A1AA]">
              {updatedAt ? `Last updated ${new Date(updatedAt).toLocaleString()}` : ''}
            </span>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#81B64C] px-5 text-xs font-bold text-[#121212] shadow-[0_4px_15px_rgba(129,182,76,0.3)] transition-colors hover:bg-[#A3D160] disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Saving...' : 'Save Download Settings'}</span>
            </button>
          </div>
        </form>
      </section>

      <aside className="rounded-[20px] border border-white/10 bg-[#141417]/90 p-6 space-y-4 self-start backdrop-blur-md">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Live Landing Button Preview</h3>
          <span
            className={`font-mono text-xs font-semibold ${
              isUrlReady ? 'text-[#4ADE80]' : 'text-[#F59E0B]'
            }`}
          >
            {isUrlReady ? 'LINK ACTIVE' : 'NO URL SET'}
          </span>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-5 space-y-4">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#81B64C]">
            RELEASE {version || 'v2.1.0'} · {fileSize || 'Chrome & Lemur MV3'}
          </div>
          <p className="text-xs leading-relaxed text-[#A1A1AA]">
            {notes || 'No install notes entered.'}
          </p>

          {isUrlReady ? (
            <a
              href={url.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#81B64C] px-5 text-sm font-bold text-[#121212] hover:bg-[#A3D160]"
            >
              <ArrowDownToLine className="h-4 w-4" />
              <span>{label || 'Download Mujahi Chess'}</span>
              <ArrowUpRight className="h-4 w-4" />
            </a>
          ) : (
            <div className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#81B64C]/85 px-5 text-sm font-bold text-[#121212]">
              <ArrowDownToLine className="h-4 w-4" />
              <span>{label || 'Download Mujahi Chess'}</span>
            </div>
          )}

          {isUrlReady && (
            <div className="flex items-center gap-1.5 truncate font-mono text-[11px] text-[#A1A1AA]">
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{url.trim()}</span>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
