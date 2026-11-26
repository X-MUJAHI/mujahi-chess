import { NextResponse } from 'next/server';
import { getPublicDownloadConfig } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = await getPublicDownloadConfig();
  return NextResponse.json(config, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
