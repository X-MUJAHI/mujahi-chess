import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type KeyTier = 'temporary' | 'premium';
export type KeyStatus = 'active' | 'revoked' | 'exhausted';

export interface LicenseKeyRecord {
  key: string;
  tier: KeyTier;
  movesTotal: number | null;
  movesRemain: number | null;
  status: KeyStatus;
  note: string;
  createdAt: string;
  lastUsedAt: string | null;
  usageCount: number;
}

export interface DownloadConfig {
  url: string;
  label: string;
  version: string;
  fileSize: string;
  notes: string;
  updatedAt: string;
}

export interface StoreData {
  downloadConfig: DownloadConfig;
  keys: LicenseKeyRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), '.mujahi-data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEY_REGEX = /^M[A-Z0-9]{7}$/;

const DEFAULT_STORE: StoreData = {
  downloadConfig: {
    url: '',
    label: 'Download Mujahi Chess',
    version: 'v2.1.0',
    fileSize: 'Chrome & Lemur MV3',
    notes:
      'Unzip the archive and load it in Developer Mode on Chromium desktop browsers or Lemur Browser on Android.',
    updatedAt: new Date(0).toISOString(),
  },
  keys: [],
};

const globalForStore = globalThis as unknown as {
  __mujahiStoreCache?: StoreData;
  __mujahiStoreLock?: Promise<void>;
};

function cloneStore(data: StoreData): StoreData {
  return {
    downloadConfig: { ...data.downloadConfig },
    keys: data.keys.map((k) => ({ ...k })),
  };
}

async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalForStore.__mujahiStoreLock ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalForStore.__mujahiStoreLock = prev.then(() => next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function loadStoreUnlocked(): Promise<StoreData> {
  if (globalForStore.__mujahiStoreCache) {
    return cloneStore(globalForStore.__mujahiStoreCache);
  }

  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    const normalized: StoreData = {
      downloadConfig: {
        ...DEFAULT_STORE.downloadConfig,
        ...(parsed.downloadConfig || {}),
      },
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
    };
    globalForStore.__mujahiStoreCache = normalized;
    return cloneStore(normalized);
  } catch {
    const seeded = cloneStore(DEFAULT_STORE);
    seeded.downloadConfig.updatedAt = new Date().toISOString();
    globalForStore.__mujahiStoreCache = seeded;
    await persistStoreUnlocked(seeded);
    return cloneStore(seeded);
  }
}

async function persistStoreUnlocked(data: StoreData): Promise<void> {
  globalForStore.__mujahiStoreCache = cloneStore(data);
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmpPath = `${STORE_PATH}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmpPath, STORE_PATH);
  } catch {
    // Keep in-memory state intact even if filesystem is read-only.
  }
}

function generateSingleMKey(existingSet: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let suffix = '';
    for (let i = 0; i < 7; i += 1) {
      suffix += KEY_ALPHABET[crypto.randomInt(0, KEY_ALPHABET.length)];
    }
    const candidate = `M${suffix}`;
    if (!existingSet.has(candidate)) {
      existingSet.add(candidate);
      return candidate;
    }
  }
  throw new Error('Unable to generate unique key.');
}

export function isValidDownloadUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function getPublicDownloadConfig(): Promise<DownloadConfig> {
  const store = await withStoreLock(() => loadStoreUnlocked());
  return store.downloadConfig;
}

export async function updateDownloadConfig(
  input: Partial<Omit<DownloadConfig, 'updatedAt'>>
): Promise<DownloadConfig> {
  return withStoreLock(async () => {
    const store = await loadStoreUnlocked();
    const nextUrl = typeof input.url === 'string' ? input.url.trim() : store.downloadConfig.url;
    if (!isValidDownloadUrl(nextUrl)) {
      throw new Error('Download URL must begin with https:// or http:// (or be left empty).');
    }

    const updated: DownloadConfig = {
      url: nextUrl,
      label:
        typeof input.label === 'string' && input.label.trim()
          ? input.label.trim().slice(0, 60)
          : 'Download Mujahi Chess',
      version:
        typeof input.version === 'string' && input.version.trim()
          ? input.version.trim().slice(0, 24)
          : 'v2.1.0',
      fileSize:
        typeof input.fileSize === 'string' && input.fileSize.trim()
          ? input.fileSize.trim().slice(0, 40)
          : 'Chrome & Lemur MV3',
      notes:
        typeof input.notes === 'string'
          ? input.notes.trim().slice(0, 280)
          : store.downloadConfig.notes,
      updatedAt: new Date().toISOString(),
    };

    store.downloadConfig = updated;
    await persistStoreUnlocked(store);
    return updated;
  });
}

export async function listAllKeys(): Promise<LicenseKeyRecord[]> {
  const store = await withStoreLock(() => loadStoreUnlocked());
  return store.keys;
}

export async function createLicenseKeys(params: {
  tier: KeyTier;
  count?: number;
  movesTotal?: number;
  note?: string;
}): Promise<LicenseKeyRecord[]> {
  const tier: KeyTier = params.tier === 'premium' ? 'premium' : 'temporary';
  const count = Math.min(25, Math.max(1, Math.floor(Number(params.count) || 1)));
  const movesTotal =
    tier === 'premium'
      ? null
      : Math.min(10000, Math.max(1, Math.floor(Number(params.movesTotal) || 60)));
  const note = typeof params.note === 'string' ? params.note.trim().slice(0, 120) : '';

  return withStoreLock(async () => {
    const store = await loadStoreUnlocked();
    const existingSet = new Set(store.keys.map((k) => k.key));
    const createdAt = new Date().toISOString();
    const created: LicenseKeyRecord[] = [];

    for (let i = 0; i < count; i += 1) {
      const record: LicenseKeyRecord = {
        key: generateSingleMKey(existingSet),
        tier,
        movesTotal,
        movesRemain: movesTotal,
        status: 'active',
        note,
        createdAt,
        lastUsedAt: null,
        usageCount: 0,
      };
      created.push(record);
    }

    store.keys = [...created, ...store.keys];
    await persistStoreUnlocked(store);
    return created;
  });
}

export async function updateLicenseKey(
  keyCode: string,
  updates: { status?: 'active' | 'revoked'; note?: string; resetMoves?: boolean }
): Promise<LicenseKeyRecord | null> {
  const normalized = keyCode.trim().toUpperCase();
  return withStoreLock(async () => {
    const store = await loadStoreUnlocked();
    const idx = store.keys.findIndex((k) => k.key === normalized);
    if (idx === -1) return null;

    const current = store.keys[idx];
    const next: LicenseKeyRecord = { ...current };

    if (typeof updates.note === 'string') {
      next.note = updates.note.trim().slice(0, 120);
    }

    if (updates.resetMoves && next.tier === 'temporary') {
      next.movesRemain = next.movesTotal ?? 60;
      if (next.status === 'exhausted') {
        next.status = 'active';
      }
    }

    if (updates.status === 'revoked') {
      next.status = 'revoked';
    } else if (updates.status === 'active') {
      if (next.tier === 'temporary' && (next.movesRemain ?? 0) <= 0) {
        next.movesRemain = next.movesTotal ?? 60;
      }
      next.status = 'active';
    }

    store.keys[idx] = next;
    await persistStoreUnlocked(store);
    return next;
  });
}

export async function deleteLicenseKey(keyCode: string): Promise<boolean> {
  const normalized = keyCode.trim().toUpperCase();
  return withStoreLock(async () => {
    const store = await loadStoreUnlocked();
    const before = store.keys.length;
    store.keys = store.keys.filter((k) => k.key !== normalized);
    if (store.keys.length === before) return false;
    await persistStoreUnlocked(store);
    return true;
  });
}

export async function verifyKeyForExtension(rawKey: string): Promise<{
  valid: boolean;
  isPremium?: boolean;
  moves_remain?: number;
  error?: string;
}> {
  const key = typeof rawKey === 'string' ? rawKey.trim().toUpperCase() : '';
  if (!KEY_REGEX.test(key)) {
    return { valid: false, error: 'Key must be 8 characters starting with M.' };
  }

  return withStoreLock(async () => {
    const store = await loadStoreUnlocked();
    const idx = store.keys.findIndex((k) => k.key === key);
    if (idx === -1) {
      return { valid: false, error: 'The key you entered is not valid or has expired.' };
    }

    const record = store.keys[idx];
    if (record.status === 'revoked') {
      return { valid: false, error: 'This license key has been revoked.' };
    }
    if (record.tier === 'temporary' && (record.status === 'exhausted' || (record.movesRemain ?? 0) <= 0)) {
      return { valid: false, error: 'This temporary key has 0 moves remaining.' };
    }

    store.keys[idx] = {
      ...record,
      lastUsedAt: new Date().toISOString(),
    };
    await persistStoreUnlocked(store);

    if (record.tier === 'premium') {
      return { valid: true, isPremium: true, moves_remain: 0 };
    }
    return {
      valid: true,
      isPremium: false,
      moves_remain: record.movesRemain ?? 0,
    };
  });
}

export async function consumeMoveForExtension(rawKey: string): Promise<{
  ok: boolean;
  isPremium?: boolean;
  moves_remain?: number;
  error?: string;
}> {
  const key = typeof rawKey === 'string' ? rawKey.trim().toUpperCase() : '';
  if (!KEY_REGEX.test(key)) {
    return { ok: false, error: 'Invalid key format.' };
  }

  return withStoreLock(async () => {
    const store = await loadStoreUnlocked();
    const idx = store.keys.findIndex((k) => k.key === key);
    if (idx === -1) {
      return { ok: false, error: 'Key not found.' };
    }

    const record = store.keys[idx];
    if (record.status === 'revoked') {
      return { ok: false, error: 'Key has been revoked.' };
    }

    const now = new Date().toISOString();
    if (record.tier === 'premium') {
      store.keys[idx] = {
        ...record,
        usageCount: record.usageCount + 1,
        lastUsedAt: now,
      };
      await persistStoreUnlocked(store);
      return { ok: true, isPremium: true };
    }

    const remaining = record.movesRemain ?? 0;
    if (remaining <= 0 || record.status === 'exhausted') {
      return { ok: false, moves_remain: 0, error: 'Key has no remaining moves.' };
    }

    const nextRemain = remaining - 1;
    store.keys[idx] = {
      ...record,
      movesRemain: nextRemain,
      status: nextRemain === 0 ? 'exhausted' : 'active',
      usageCount: record.usageCount + 1,
      lastUsedAt: now,
    };
    await persistStoreUnlocked(store);
    return { ok: true, isPremium: false, moves_remain: nextRemain };
  });
}
