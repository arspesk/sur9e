'use server';

// Server Actions for the ATS portals resource (inputs/personalization/
// portals.yml). Thin glue: zod-parse → src/lib/server/portals.ts →
// revalidatePath('/settings') — the only surface that renders the list
// (the Scanning section's summary panel and the ATS portals section).

import { ROOT } from '@/lib/root';
import { PortalsShape } from '@/lib/schemas/portals';
import { importExamplePortals, loadPortals, savePortals } from '@/lib/server/portals';
import { revalidatePath } from '@/server/revalidate';

export interface SavePortalsResult {
  ok: true;
  portals: PortalsShape;
}

/**
 * Read-only action — backs the usePortalsQuery refetch path. The /settings
 * RSC page itself calls loadPortals(ROOT) directly and passes initialData.
 */
export async function loadPortalsAction(): Promise<PortalsShape | null> {
  return loadPortals(ROOT);
}

/** Full-replace save: the ATS portals section always sends the whole shape. */
export async function savePortalsAction(data: unknown): Promise<SavePortalsResult> {
  const parsed = PortalsShape.parse(data);
  savePortals(ROOT, parsed);
  revalidatePath('/settings');
  return { ok: true, portals: parsed };
}

/**
 * Bootstrap convenience for the empty state: copies the example company
 * list into portals.yml. importExamplePortals throws when the user already
 * has tracked companies — never an overwrite.
 */
export async function importExamplePortalsAction(): Promise<SavePortalsResult> {
  const portals = importExamplePortals(ROOT);
  revalidatePath('/settings');
  return { ok: true, portals };
}
