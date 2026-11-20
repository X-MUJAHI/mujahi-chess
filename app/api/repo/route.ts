import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

const REPO_ROOT = path.resolve(process.cwd(), 'mujahi-chess-engine');
const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist']);

interface RepoFileEntry {
  path: string;
  sizeBytes: number;
  category: string;
}

function categorizePath(relPath: string): string {
  if (relPath.startsWith('api/')) return 'Render Backend (API)';
  if (relPath.startsWith('website/')) return 'Vercel Frontend';
  if (relPath.startsWith('examples/')) return 'Chess Helper 2.1.0';
  if (relPath.startsWith('docs/')) return 'Documentation';
  if (relPath.startsWith('LICENSES/')) return 'Compliance';
  if (relPath.startsWith('.github/')) return 'CI / GitHub';
  return 'Repository Root';
}

async function collectFiles(dir: string, acc: RepoFileEntry[] = []): Promise<RepoFileEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, acc);
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      const relPath = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
      acc.push({
        path: relPath,
        sizeBytes: stat.size,
        category: categorizePath(relPath),
      });
    }
  }
  return acc;
}

export async function GET(req: NextRequest) {
  const fileParam = req.nextUrl.searchParams.get('file');

  try {
    await fs.access(REPO_ROOT);
  } catch {
    return NextResponse.json(
      { error: 'Monorepo directory mujahi-chess-engine was not found.' },
      { status: 404 }
    );
  }

  if (!fileParam) {
    const files = await collectFiles(REPO_ROOT);
    return NextResponse.json({
      root: 'mujahi-chess-engine',
      count: files.length,
      files,
    });
  }

  const normalizedRel = fileParam.replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(REPO_ROOT, normalizedRel);

  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) {
    return NextResponse.json({ error: 'Invalid file path.' }, { status: 400 });
  }

  const segments = normalizedRel.split('/');
  if (segments.some((seg) => IGNORED_DIRS.has(seg))) {
    return NextResponse.json({ error: 'Access to ignored directory is forbidden.' }, { status: 403 });
  }

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Requested path is not a file.' }, { status: 400 });
    }
    if (stat.size > 512 * 1024) {
      return NextResponse.json({ error: 'File exceeds preview size limit.' }, { status: 413 });
    }

    const content = await fs.readFile(resolved, 'utf8');
    return NextResponse.json({
      path: normalizedRel,
      sizeBytes: stat.size,
      category: categorizePath(normalizedRel),
      content,
    });
  } catch {
    return NextResponse.json({ error: 'Requested file not found.' }, { status: 404 });
  }
}
