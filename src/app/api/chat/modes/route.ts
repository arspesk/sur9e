export const runtime = 'nodejs';

import { MODE_ALIASES, MODE_CATALOG } from '@/lib/modes/catalog';

export async function GET() {
  return Response.json({
    modes: Object.values(MODE_CATALOG),
    aliases: MODE_ALIASES,
  });
}
