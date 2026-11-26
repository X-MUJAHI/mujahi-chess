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

  // Generator state
  const [tier, setTier] = useState<KeyTier>('temporary');
  const [movesTotal, setMovesTotal] = useState('60');
  const [count, setCount] = useState('1');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<LicenseKeyRecord[]>([]);

  // Filter & UI state
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
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
          <div className="text-xs font-medium text-[#6B7280]">Total Keys</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#111827]">{stats.total}</div>
        </div>
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
          <div className="text-xs font-medium text-[#6B7280]">Active</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#16A34A]">{stats.active}</div>
        </div>
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
          <div className="text-xs font-medium text-[#6B7280]">Premium</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#14532D]">{stats.premium}</div>
        </div>
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
          <div className="text-xs font-medium text-[#6B7280]">Temporary</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#111827]">{stats.temporary}</div>
        </div>
      </div>

      <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2
              className="text-base font-bold text-[#111827]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Generate 8-Character M-Keys
            </h2>
            <p className="text-xs text-[#6B7280]">
              Every generated key is 8 uppercase characters starting with <code className="font-mono font-semibold text-[#14532D]">M</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={loadKeys}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-[#FAF9F6] px-3 text-xs font-medium text-[#374151] hover:border-[#14532D]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
        </div>

        <form onSubmit={handleGenerate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[150px_130px_100px_1fr_auto]">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#4B5563]">Tier</label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as KeyTier)}
              className="h-9 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-2.5 text-xs font-medium text-[#111827] focus:border-[#14532D] focus:outline-none"
            >
              <option value="temporary">Temporary</option>
              <option value="premium">Premium (Unlimited)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#4B5563]">Moves Allowance</label>
            <input
              type="number"
              min={1}
              max={10000}
              value={tier === 'premium' ? '' : movesTotal}
              placeholder={tier === 'premium' ? 'Unlimited' : '60'}
              disabled={tier === 'premium'}
              onChange={(e) => setMovesTotal(e.target.value)}
              className="h-9 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-3 font-mono text-xs text-[#111827] disabled:bg-[#F3F4F6] disabled:text-[#6B7280] focus:border-[#14532D] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#4B5563]">Quantity</label>
            <input
              type="number"
              min={1}
              max={25}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="h-9 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-3 font-mono text-xs text-[#111827] focus:border-[#14532D] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#4B5563]">Label / Note (Optional)</label>
            <input
              type="text"
              maxLength={120}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Batch #4 or User name"
              className="h-9 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-3 text-xs text-[#111827] placeholder-[#9CA3AF] focus:border-[#14532D] focus:outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[#14532D] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#15803D] disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{creating ? 'Minting...' : 'Generate Key'}</span>
            </button>
          </div>
        </form>

        {newlyCreated.length > 0 && (
          <div className="mt-4 rounded-lg border border-[#15803D]/25 bg-[#ECFDF5] p-3.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#14532D]">
                Newly Generated ({newlyCreated.length})
              </span>
              <button
                type="button"
                onClick={copyAllNew}
                className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded border border-[#15803D]/30 bg-white px-2.5 text-xs font-medium text-[#14532D] hover:bg-[#F0FDF4]"
              >
                {copiedBatch ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                <span>{copiedBatch ? 'Copied All' : 'Copy All'}</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {newlyCreated.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => copySingle(item.key)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-[#15803D]/25 bg-white px-2.5 py-1 font-mono text-xs font-semibold text-[#111827] hover:border-[#14532D]"
                >
                  <span>{item.key}</span>
                  {copiedKey === item.key ? (
                    <Check className="h-3 w-3 text-[#16A34A]" />
                  ) : (
                    <Copy className="h-3 w-3 text-[#6B7280]" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-[#DC2626]/30 bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#B91C1C]">
            {error}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] px-5 py-3.5">
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search key or note..."
              className="h-8 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] pl-8 pr-3 text-xs text-[#111827] placeholder-[#9CA3AF] focus:border-[#14532D] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as 'all' | KeyTier)}
              aria-label="Filter by tier"
              className="h-8 rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-2.5 text-xs text-[#374151] focus:border-[#14532D] focus:outline-none"
            >
              <option value="all">All Tiers</option>
              <option value="temporary">Temporary</option>
              <option value="premium">Premium</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | KeyStatus)}
              aria-label="Filter by status"
              className="h-8 rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-2.5 text-xs text-[#374151] focus:border-[#14532D] focus:outline-none"
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
            <div className="h-10 rounded bg-[#F3F4F6]" />
            <div className="h-10 rounded bg-[#F3F4F6]" />
            <div className="h-10 rounded bg-[#F3F4F6]" />
          </div>
        ) : filteredKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <KeyRound className="h-7 w-7 text-[#9CA3AF]" />
            <div className="text-sm font-semibold text-[#111827]">
              {keys.length === 0 ? 'No license keys created yet' : 'No keys match your filters'}
            </div>
            <p className="max-w-sm text-xs text-[#6B7280]">
              {keys.length === 0
                ? 'Use the generator above to mint an 8-character M-prefixed Temporary or Premium key.'
                : 'Clear or adjust the search and status filters to view all keys.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E5E7EB] bg-[#FAF9F6] font-mono uppercase text-[11px] text-[#6B7280]">
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
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredKeys.map((item) => {
                  const isBusy = busyKey === item.key;
                  return (
                    <tr key={item.key} className="h-11 hover:bg-[#FAF9F6]">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-[#111827]">
                            {item.key}
                          </span>
                          <button
                            type="button"
                            onClick={() => copySingle(item.key)}
                            title="Copy key"
                            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#14532D] hover:text-[#14532D]"
                          >
                            {copiedKey === item.key ? (
                              <Check className="h-3 w-3 text-[#16A34A]" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-2 font-medium text-[#374151]">
                        {item.tier === 'premium' ? 'Premium' : 'Temporary'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[#111827]">
                        {item.tier === 'premium'
                          ? 'Unlimited'
                          : `${item.movesRemain ?? 0} / ${item.movesTotal ?? 60}`}
                      </td>
                      <td className="px-4 py-2 font-mono font-semibold">
                        <span
                          className={
                            item.status === 'active'
                              ? 'text-[#16A34A]'
                              : item.status === 'exhausted'
                                ? 'text-[#D97706]'
                                : 'text-[#DC2626]'
                          }
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-2 text-[#4B5563]">
                        {item.note || '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-[#6B7280] whitespace-nowrap">
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
                              className="inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-[#D1D5DB] bg-white px-2 text-[11px] font-medium text-[#374151] hover:border-[#14532D] disabled:opacity-50"
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
                                ? 'border-[#16A34A]/40 bg-[#ECFDF5] text-[#14532D]'
                                : 'border-[#D97706]/40 bg-[#FFFBEB] text-[#B45309]'
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
                              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-[#E5E7EB] bg-white text-[#6B7280] hover:border-[#DC2626] hover:text-[#DC2626]"
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
