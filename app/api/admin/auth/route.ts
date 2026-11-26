import { NextRequest, NextResponse } from 'next/server';
import {
  attachSessionCookie,
  checkLoginRateLimit,
  clearSessionCookie,
  createSessionToken,
  isAdminRequest,
  resetLoginRateLimit,
  verifyAdminMutationHeaders,
  verifyAdminPassword,
} from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  return NextResponse.json(
    { authenticated: isAdminRequest(req) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(req: NextRequest) {
  if (!verifyAdminMutationHeaders(req)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const clientKey =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('host') ||
    'default';

  const rate = checkLoginRateLimit(clientKey);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `Too many sign-in attempts. Try again in ${rate.retryAfterSec || 60}s.` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Incorrect admin password.' }, { status: 401 });
  }

  resetLoginRateLimit(clientKey);
  const token = createSessionToken();
  const res = NextResponse.json({ authenticated: true });
  attachSessionCookie(res, token);
  return res;
}

export async function DELETE(req: NextRequest) {
  if (!verifyAdminMutationHeaders(req)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const res = NextResponse.json({ authenticated: false });
  clearSessionCookie(res);
  return res;
}
