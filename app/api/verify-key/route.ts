import { NextRequest, NextResponse } from 'next/server';
import { verifyKeyForExtension } from '@/lib/store';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { key?: unknown } | null;
    const rawKey = typeof body?.key === 'string' ? body.key : '';
    const result = await verifyKeyForExtension(rawKey);
    return NextResponse.json(result, { headers: CORS_HEADERS });
  } catch {
    return NextResponse.json(
      { valid: false, error: 'Unable to verify license key.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}
