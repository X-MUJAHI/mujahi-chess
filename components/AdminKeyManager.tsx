'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { KeyStatus, KeyTier, LicenseKeyRecord } from '@/lib/store';

interface KeyStats {
  total: number;
  active: number;
  premium: number;
  temporary: number;
  revoked: number;
  exhausted: number;
}

const ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  'X-Requested-With': 'MujahiAdmin',
};

function formatShortDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminKeyManager({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [keys, setKeys] = useState<LicenseKeyRecord[]>([]);
  const [stats, setStats] = useState<KeyStats>({
    total: 0,
    active: 0,
    premium: 0,
    temporary: 0,
    revoked: 0,
    exhausted: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tier, setTier] = useState<KeyTier>('temporary');
  const [movesTotal, setMovesTotal] = useState('60');
  const [count, setCount] = useState('1');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<LicenseKeyRecord[]>([]);

  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | KeyTier>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | KeyStatus>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedBatch, setCopiedBatch] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/keys', { cache: 'no-store' });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load license keys');
      setKeys(data.keys || []);
      if (data.stats) setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch keys');
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/keys', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) {
          if (active) onUnauthorized();
          return null;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load license keys');
        return data;
      })
      .then((data) => {
        if (!active || !data) return;
        setKeys(data.keys || []);
        if (data.stats) setStats(data.stats);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to fetch keys');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({
          tier,
          count: Number(count) || 1,
          movesTotal: tier === 'temporary' ? Number(movesTotal) || 60 : undefined,
          note,
        }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate key');
      setNewlyCreated(data.created || []);
      setNote('');
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key generation failed');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateKey = async (
    keyCode: string,
    payload: { status?: 'active' | 'revoked'; resetMoves?: boolean }
  ) => {
    setBusyKey(keyCode);
    setError(null);
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'PATCH',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ key: keyCode, ...payload }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update key');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteKey = async (keyCode: string) => {
    setBusyKey(keyCode);
    setError(null);
    try {
      const res = await fetch(`/api/admin/keys?key=${encodeURIComponent(keyCode)}`, {
        method: 'DELETE',
        headers: ADMIN_HEADERS,
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setPendingDelete(null);
      setNewlyCreated((prev) => prev.filter((item) => item.key !== keyCode));
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete key');
    } finally {
      setBusyKey(null);
    }
  };

  const copySingle = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedKey(code);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  const copyAllNew = async () => {
    if (newlyCreated.length === 0) return;
    try {
      await navigator.clipboard.writeText(newlyCreated.map((k) => k.key).join('\n'));
      setCopiedBatch(true);
      setTimeout(() => setCopiedBatch(false), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase();
    return keys.filter((k) => {
      if (tierFilter !== 'all' && k.tier !== tierFilter) return false;
      if (statusFilter !== 'all' && k.status !== statusFilter) return false;
      if (q && !k.key.toLowerCase().includes(q) && !k.note.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [keys, search, tierFilter, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-[#141417]/85 p-4">
          <div className="text-xs font-medium text-[#A1A1AA]">Total Keys</div>
          <div className="mt-1 font-mono text-2xl font-bold text-white">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#141417]/85 p-4">
          <div className="text-xs font-medium text-[#A1A1AA]">Active</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#81B64C]">{stats.active}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#141417]/85 p-4">
          <div className="text-xs font-medium text-[#A1A1AA]">Premium</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#FFD700]">{stats.premium}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#141417]/85 p-4">
          <div className="text-xs font-medium text-[#A1A1AA]">Temporary</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#A5C7FF]">{stats.temporary}</div>
        </div>
      </div>

      <section className="rounded-[20px] border border-white/10 bg-[#141417]/90 p-5 backdrop-blur-md">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2
              className="text-base font-bold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Generate 8-Character M-Keys
            </h2>
            <p className="text-xs text-[#A1A1AA]">
              Every generated key is 8 uppercase characters starting with{' '}
              <code className="font-mono font-semibold text-[#81B64C]">M</code>. Temporary keys enforce
              depth {'<='} 7 server-side; Premium keys unlock full engine depth.
            </p>
          </div>
          <button
            type="button"
            onClick={loadKeys}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-[#E4E4E7] hover:bg-white/10"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
        </div>

        <form onSubmit={handleGenerate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[160px_130px_100px_1fr_auto]">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#A1A1AA]">Tier</label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as KeyTier)}
              className="h-9 w-full rounded-lg border border-white/10 bg-[#1C1C21] px-2.5 text-xs font-medium text-white focus:border-[#81B64C] focus:outline-none"
            >
              <option value="temporary">Temporary</option>
              <option value="premium">Premium (Unlimited)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#A1A1AA]">Moves Allowance</label>
            <input
              type="number"
              min={1}
              max={10000}
              value={tier === 'premium' ? '' : movesTotal}
              placeholder={tier === 'premium' ? 'Unlimited' : '60'}
              disabled={tier === 'premium'}
              onChange={(e) => setMovesTotal(e.target.value)}
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-xs text-white disabled:opacity-45 focus:border-[#81B64C] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#A1A1AA]">Quantity</label>
            <input
              type="number"
              min={1}
              max={25}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-xs text-white focus:border-[#81B64C] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#A1A1AA]">Label / Note (Optional)</label>
            <input
              type="text"
              maxLength={120}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Batch #4 or User name"
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-[#71717A] focus:border-[#81B64C] focus:outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#81B64C] px-4 text-xs font-bold text-[#121212] shadow-[0_4px_15px_rgba(129,182,76,0.3)] transition-colors hover:bg-[#A3D160] disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{creating ? 'Minting...' : 'Generate Key'}</span>
            </button>
          </div>
        </form>

        {newlyCreated.length > 0 && (
          <div className="mt-4 rounded-xl border border-[#81B64C]/30 bg-[#81B64C]/10 p-3.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#A3D160]">
                Newly Generated ({newlyCreated.length})
              </span>
              <button
                type="button"
                onClick={copyAllNew}
                className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-black/30 px-2.5 text-xs font-medium text-white hover:bg-black/50"
              >
                {copiedBatch ? <Check className="h-3 w-3 text-[#81B64C]" /> : <Copy className="h-3 w-3" />}
                <span>{copiedBatch ? 'Copied All' : 'Copy All'}</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {newlyCreated.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => copySingle(item.key)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-black/40 px-2.5 py-1 font-mono text-xs font-semibold text-white hover:border-[#81B64C]"
                >
                  <span>{item.key}</span>
                  {copiedKey === item.key ? (
                    <Check className="h-3 w-3 text-[#81B64C]" />
                  ) : (
                    <Copy className="h-3 w-3 text-[#A1A1AA]" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-[#F87171]/35 bg-[#F87171]/10 px-3.5 py-2.5 text-xs text-[#FECACA]">
            {error}
          </div>
        )}
      </section>

      <section className="rounded-[20px] border border-white/10 bg-[#141417]/90 overflow-hidden backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#71717A]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search key or note..."
              className="h-8 w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 text-xs text-white placeholder-[#71717A] focus:border-[#81B64C] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as 'all' | KeyTier)}
              aria-label="Filter by tier"
              className="h-8 rounded-lg border border-white/10 bg-[#1C1C21] px-2.5 text-xs text-white focus:border-[#81B64C] focus:outline-none"
            >
              <option value="all">All Tiers</option>
              <option value="temporary">Temporary</option>
              <option value="premium">Premium</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | KeyStatus)}
              aria-label="Filter by status"
              className="h-8 rounded-lg border border-white/10 bg-[#1C1C21] px-2.5 text-xs text-white focus:border-[#81B64C] focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="revoked">Revoked</option>
              <option value="exhausted">Exhausted</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-5">
            <div className="h-10 rounded-lg bg-white/5" />
            <div className="h-10 rounded-lg bg-white/5" />
            <div className="h-10 rounded-lg bg-white/5" />
          </div>
        ) : filteredKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <KeyRound className="h-7 w-7 text-[#71717A]" />
            <div className="text-sm font-semibold text-white">
              {keys.length === 0 ? 'No license keys created yet' : 'No keys match your filters'}
            </div>
            <p className="max-w-sm text-xs text-[#A1A1AA]">
              {keys.length === 0
                ? 'Use the generator above to mint an 8-character M-prefixed Temporary or Premium key.'
                : 'Clear or adjust the search and status filters to view all keys.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 bg-black/25 font-mono uppercase text-[11px] text-[#A1A1AA]">
                <tr>
                  <th className="px-4 py-2.5">Key</th>
                  <th className="px-4 py-2.5">Tier</th>
                  <th className="px-4 py-2.5 text-right">Moves</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Note</th>
                  <th className="px-4 py-2.5">Last Used</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {filteredKeys.map((item) => {
                  const isBusy = busyKey === item.key;
                  return (
                    <tr key={item.key} className="h-11 hover:bg-white/[0.03]">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-white">
                            {item.key}
                          </span>
                          <button
                            type="button"
                            onClick={() => copySingle(item.key)}
                            title="Copy key"
                            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-white/10 bg-white/5 text-[#A1A1AA] hover:border-[#81B64C] hover:text-white"
                          >
                            {copiedKey === item.key ? (
                              <Check className="h-3 w-3 text-[#81B64C]" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-2 font-medium text-[#E4E4E7]">
                        {item.tier === 'premium' ? (
                          <span className="text-[#FFD700]">Premium</span>
                        ) : (
                          'Temporary'
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-white">
                        {item.tier === 'premium'
                          ? 'Unlimited'
                          : `${item.movesRemain ?? 0} / ${item.movesTotal ?? 60}`}
                      </td>
                      <td className="px-4 py-2 font-mono font-semibold">
                        <span
                          className={
                            item.status === 'active'
                              ? 'text-[#4ADE80]'
                              : item.status === 'exhausted'
                                ? 'text-[#F59E0B]'
                                : 'text-[#F87171]'
                          }
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-2 text-[#A1A1AA]">
                        {item.note || '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-[#A1A1AA] whitespace-nowrap">
                        {formatShortDate(item.lastUsedAt)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {item.tier === 'temporary' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleUpdateKey(item.key, { resetMoves: true })}
                              title="Reset moves to initial allowance"
                              className="inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-[#E4E4E7] hover:border-[#81B64C] disabled:opacity-50"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Reset</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              handleUpdateKey(item.key, {
                                status: item.status === 'revoked' ? 'active' : 'revoked',
                              })
                            }
                            className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-[11px] font-medium disabled:opacity-50 ${
                              item.status === 'revoked'
                                ? 'border-[#81B64C]/40 bg-[#81B64C]/15 text-[#A3D160]'
                                : 'border-[#F59E0B]/35 bg-[#F59E0B]/10 text-[#FDE68A]'
                            }`}
                          >
                            <Ban className="h-3 w-3" />
                            <span>{item.status === 'revoked' ? 'Restore' : 'Revoke'}</span>
                          </button>

                          {pendingDelete === item.key ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDeleteKey(item.key)}
                              className="inline-flex h-7 cursor-pointer items-center gap-1 rounded bg-[#DC2626] px-2 text-[11px] font-semibold text-white hover:bg-[#B91C1C]"
                            >
                              Confirm
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setPendingDelete(item.key)}
                              title="Delete key"
                              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-white/10 bg-white/5 text-[#A1A1AA] hover:border-[#F87171] hover:text-[#F87171]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
