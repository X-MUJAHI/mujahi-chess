import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, verifyAdminMutationHeaders } from '@/lib/admin-auth';
import {
  createLicenseKeys,
  deleteLicenseKey,
  listAllKeys,
  updateLicenseKey,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const keys = await listAllKeys();
  const stats = {
    total: keys.length,
    active: keys.filter((k) => k.status === 'active').length,
    premium: keys.filter((k) => k.tier === 'premium').length,
    temporary: keys.filter((k) => k.tier === 'temporary').length,
    revoked: keys.filter((k) => k.status === 'revoked').length,
    exhausted: keys.filter((k) => k.status === 'exhausted').length,
  };

  return NextResponse.json({ keys, stats }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!verifyAdminMutationHeaders(req)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    tier?: string;
    count?: number;
    movesTotal?: number;
    note?: string;
  } | null;

  const created = await createLicenseKeys({
    tier: body?.tier === 'premium' ? 'premium' : 'temporary',
    count: body?.count,
    movesTotal: body?.movesTotal,
    note: body?.note,
  });

  return NextResponse.json({ created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!verifyAdminMutationHeaders(req)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    key?: string;
    status?: 'active' | 'revoked';
    note?: string;
    resetMoves?: boolean;
  } | null;

  if (!body?.key || typeof body.key !== 'string') {
    return NextResponse.json({ error: 'Key identifier is required.' }, { status: 400 });
  }

  const updated = await updateLicenseKey(body.key, {
    status: body.status,
    note: body.note,
    resetMoves: Boolean(body.resetMoves),
  });

  if (!updated) {
    return NextResponse.json({ error: 'License key not found.' }, { status: 404 });
  }

  return NextResponse.json({ key: updated });
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!verifyAdminMutationHeaders(req)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const keyParam = req.nextUrl.searchParams.get('key');
  const body = (await req.json().catch(() => null)) as { key?: string } | null;
  const targetKey = keyParam || body?.key || '';

  if (!targetKey) {
    return NextResponse.json({ error: 'Key identifier is required.' }, { status: 400 });
  }

  const deleted = await deleteLicenseKey(targetKey);
  if (!deleted) {
    return NextResponse.json({ error: 'License key not found.' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
