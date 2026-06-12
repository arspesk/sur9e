export const runtime = 'nodejs';

import { execFileSync } from 'node:child_process';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';

export function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && new URL(origin).host !== host) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    const out = execFileSync('node', ['update-system.mjs', 'rollback'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 120000,
    });
    return Response.json({ ok: true, output: out });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to rollback update', 500);
  }
}
