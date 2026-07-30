export const runtime = 'nodejs';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonError } from '@/lib/http-errors';
import { MODE_CATALOG, resolveModeId } from '@/lib/modes/catalog';
import { ROOT } from '@/lib/root';

const HANDOFFS: Readonly<Record<string, string>> = {
  apply: '/sur9e apply <offer-number>',
  enrich: '/sur9e enrich',
};

export async function GET(_request: Request, context: { params: Promise<{ mode: string }> }) {
  const { mode: rawMode } = await context.params;
  const mode = resolveModeId(rawMode);
  if (!mode) return jsonError(`unknown mode: ${rawMode}`, 404);
  const definition = MODE_CATALOG[mode];
  let instructions = '';
  if (mode !== 'screen-evaluate') {
    const modePath = join(ROOT, 'content', 'modes', `${mode}.md`);
    const shared =
      mode === 'screen' ? '' : readFileSync(join(ROOT, 'content', 'modes', '_shared.md'), 'utf-8');
    instructions = `${shared}${shared ? '\n\n' : ''}${readFileSync(modePath, 'utf-8')}`;
  }
  return Response.json({
    ...definition,
    canonicalMode: mode,
    instructions,
    ...(HANDOFFS[mode] ? { handoff: HANDOFFS[mode] } : {}),
  });
}
