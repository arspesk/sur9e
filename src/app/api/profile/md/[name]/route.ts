export const runtime = 'nodejs';

import { join } from 'node:path';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { atomicWrite } from '@/lib/server/atomic-write';
import { readFileOrNull } from '@/lib/server/read-or-null';

// Allowed markdown file names (keys) and their paths relative to ROOT.
// Mirror the Express MD_FILES allow-list exactly.
const MD_FILES: Record<string, string> = {
  cv: 'inputs/personalization/cv.md',
  narrative: 'inputs/personalization/narrative.md',
  'article-digest': 'inputs/personalization/article-digest.md',
};

interface Params {
  params: Promise<{ name: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { name } = await params;
  // Object.hasOwn: a plain-object lookup resolves through the prototype
  // chain, so names like 'constructor' or 'toString' would be truthy and
  // crash join() with a 500 instead of returning the intended 404.
  const rel = Object.hasOwn(MD_FILES, name) ? MD_FILES[name] : undefined;
  if (!rel) {
    return new Response('unknown md file', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  const abs = join(ROOT, rel);
  return new Response(readFileOrNull(abs) ?? '', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { name } = await params;
  // See GET: guard against prototype-chain hits like 'constructor'.
  const rel = Object.hasOwn(MD_FILES, name) ? MD_FILES[name] : undefined;
  if (!rel) {
    return new Response('unknown md file', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  const abs = join(ROOT, rel);
  try {
    const body = await request.text();
    atomicWrite(abs, body);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to write md file');
  }
}
