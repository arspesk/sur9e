'use server';

// Pipeline-queue mutations invoked from the Settings → Job scanning status
// panel. Reads stay in lib/server/pipeline (loadPipeline); this is the thin
// write surface.

import { ROOT } from '@/lib/root';
import { clearPending } from '@/lib/server/pipeline';
import { revalidatePath } from '@/server/revalidate';

/**
 * Clear every pending offer from the scan queue (data/pipeline.md `- [ ]`
 * rows). Returns how many were removed. Scan-history is left intact, so the
 * cleared offers stay deduped and won't reappear on the next scan. Revalidate
 * the surfaces whose pending/queue view changes.
 */
export async function clearPendingQueueAction(): Promise<{ removed: number }> {
  const removed = clearPending(ROOT);
  revalidatePath('/settings');
  revalidatePath('/offers');
  revalidatePath('/pipeline');
  return { removed };
}
