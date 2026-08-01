export const runtime = 'nodejs';

import { join } from 'node:path';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { readFileOrNull } from '@/lib/server/read-or-null';

export function GET() {
  const versionPath = join(ROOT, 'VERSION');
  const raw = readFileOrNull(versionPath);
  if (raw == null) return jsonError('Version file not found', 404);
  return Response.json({ version: raw.trim() });
}
