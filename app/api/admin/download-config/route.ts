import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, verifyAdminMutationHeaders } from '@/lib/admin-auth';
import { getPublicDownloadConfig, updateDownloadConfig } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const config = await getPublicDownloadConfig();
  return NextResponse.json(config, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!verifyAdminMutationHeaders(req)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    url?: string;
    label?: string;
    version?: string;
    fileSize?: string;
    notes?: string;
  } | null;

  if (!body) {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
  }

  try {
    const updated = await updateDownloadConfig(body);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save download config.' },
      { status: 400 }
    );
  }
}
