export const runtime = 'nodejs';

import { execFileSync } from 'node:child_process';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';

export function GET() {
  try {
    const out = execFileSync('node', ['update-system.mjs', 'check'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30000,
    });
    return Response.json(JSON.parse(out.trim()));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to check for updates');
  }
}
