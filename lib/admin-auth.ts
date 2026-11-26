import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const ADMIN_COOKIE_NAME = 'mujahi_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const DEFAULT_PASSCODE_SALT = 'mujahi-chess-admin-salt-2026';
const DEFAULT_PASSCODE_SCRYPT_HEX =
  'f7d2b5fc210d4a90c4e51e1099409b634eb23c116b02fd9985f7381e6b50dcba';

const globalForAuth = globalThis as unknown as {
  __mujahiSessionSecret?: string;
  __mujahiAuthAttempts?: Map<string, { count: number; resetAt: number }>;
};

function getSessionSecret(): string {
  if (process.env.ADMIN_SESSION_SECRET && process.env.ADMIN_SESSION_SECRET.trim().length >= 16) {
    return process.env.ADMIN_SESSION_SECRET.trim();
  }
  if (!globalForAuth.__mujahiSessionSecret) {
    globalForAuth.__mujahiSessionSecret = crypto.randomBytes(32).toString('hex');
  }
  return globalForAuth.__mujahiSessionSecret;
}

export function verifyAdminPassword(candidate: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 256) {
    return false;
  }

  const configured = process.env.ADMIN_PASSWORD?.trim();
  if (configured && configured.length > 0) {
    const candidateHash = crypto.createHash('sha256').update(candidate).digest();
    const expectedHash = crypto.createHash('sha256').update(configured).digest();
    return crypto.timingSafeEqual(candidateHash, expectedHash);
  }

  const derived = crypto.scryptSync(candidate, DEFAULT_PASSCODE_SALT, 32);
  const expected = Buffer.from(DEFAULT_PASSCODE_SCRYPT_HEX, 'hex');
  return crypto.timingSafeEqual(derived, expected);
}

export function checkLoginRateLimit(clientKey: string): { allowed: boolean; retryAfterSec?: number } {
  if (!globalForAuth.__mujahiAuthAttempts) {
    globalForAuth.__mujahiAuthAttempts = new Map();
  }
  const store = globalForAuth.__mujahiAuthAttempts;
  const now = Date.now();
  const entry = store.get(clientKey);
  if (!entry || now > entry.resetAt) {
    store.set(clientKey, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return { allowed: true };
  }
  if (entry.count >= 15) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true };
}

export function resetLoginRateLimit(clientKey: string): void {
  globalForAuth.__mujahiAuthAttempts?.delete(clientKey);
}

export function createSessionToken(): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ role: 'admin', iat, exp }), 'utf8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== 'string') return false;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return false;
  const payload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  if (!payload || !providedSig) return false;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    if (parsed.role !== 'admin') return false;
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isAdminRequest(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export async function isAdminServerSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export function verifyAdminMutationHeaders(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return false;
      }
    } catch {
      return false;
    }
  }
  const requestedWith = req.headers.get('x-requested-with');
  return requestedWith === 'MujahiAdmin';
}

export function attachSessionCookie(res: NextResponse, token: string): void {
  res.headers.append(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=None; Partitioned`
  );
}

export function clearSessionCookie(res: NextResponse): void {
  res.headers.append(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`
  );
}
