import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeEngineForKey, type EngineFeature } from '@/lib/store';

function timingSafeSecretMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function extractProvidedSecret(req: NextRequest): string {
  const headerSecret = req.headers.get('x-engine-auth-secret');
  if (headerSecret && headerSecret.trim()) {
    return headerSecret.trim();
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  return '';
}

export async function POST(req: NextRequest) {
  const expectedSecret = (process.env.ENGINE_AUTH_SECRET || '').trim();
  if (!expectedSecret) {
    return NextResponse.json(
      {
        authorized: false,
        code: 'AUTH_MISCONFIGURED',
        error: 'ENGINE_AUTH_SECRET is not configured on the key server.',
      },
      { status: 503 }
    );
  }

  const providedSecret = extractProvidedSecret(req);
  if (!providedSecret || !timingSafeSecretMatch(providedSecret, expectedSecret)) {
    return NextResponse.json(
      {
        authorized: false,
        code: 'UNAUTHORIZED_ENGINE_SERVICE',
        error: 'Invalid or missing engine service authentication secret.',
      },
      { status: 401 }
    );
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      key?: unknown;
      fen?: unknown;
      requestedMaxDepth?: unknown;
      feature?: unknown;
      charge?: unknown;
    } | null;

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { authorized: false, code: 'INVALID_BODY', error: 'Request body must be JSON.' },
        { status: 400 }
      );
    }

    const key = typeof body.key === 'string' ? body.key : '';
    const fen = typeof body.fen === 'string' ? body.fen : '';
    const feature: EngineFeature = body.feature === 'soft-mistakes' ? 'soft-mistakes' : 'analyze';
    const charge = body.charge !== false;
    const requestedMaxDepth =
      typeof body.requestedMaxDepth === 'number' && Number.isFinite(body.requestedMaxDepth)
        ? Math.floor(body.requestedMaxDepth)
        : undefined;

    const result = await authorizeEngineForKey({
      key,
      fen,
      requestedMaxDepth,
      feature,
      charge,
    });

    return NextResponse.json(result, { status: result.status });
  } catch {
    return NextResponse.json(
      {
        authorized: false,
        code: 'INTERNAL_SERVER_ERROR',
        error: 'Unable to authorize engine request.',
      },
      { status: 500 }
    );
  }
}
