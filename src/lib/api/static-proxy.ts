import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json',
};

export async function serveFromDir(dir: string, segments: string[]) {
  const safe = normalize(segments.join('/'));
  if (safe.startsWith('..') || safe.includes(`${sep}..${sep}`)) {
    return jsonError('Path traversal blocked', 400);
  }
  const baseDir = join(ROOT, dir);
  const target = join(baseDir, safe);
  // Defense-in-depth: startsWith check catches anything normalize() missed.
  // We intentionally follow symlinks within the directory (matches express.static behavior).
  if (!target.startsWith(baseDir + sep)) return jsonError('Path traversal blocked', 400);
  try {
    const file = await readFile(target);
    const ext = target.split('.').pop()?.toLowerCase() ?? '';
    return new Response(file, {
      headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
    });
  } catch {
    return jsonError('Not found', 404);
  }
}
