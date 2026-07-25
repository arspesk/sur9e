'use server';

// Server Action for logging a sent follow-up from the Home tab. Writes the
// canonical pipe-table row to data/follow-ups.md (the same file and format
// cli/followup-cadence.mjs reads), then revalidates Home so the RSC-computed
// cadence state refreshes.

import { z } from 'zod';
import { ROOT } from '@/lib/root';
import { type FollowupLogRow, logFollowup } from '@/lib/server/followups';
import { revalidatePath } from '@/server/revalidate';

const inputSchema = z.object({
  appNum: z.number().int().positive(),
  channel: z.string().max(40).optional(),
  notes: z.string().max(300).optional(),
});

export async function logFollowupAction(input: {
  appNum: number;
  channel?: string;
  notes?: string;
}): Promise<FollowupLogRow> {
  const parsed = inputSchema.parse(input);
  const row = logFollowup(ROOT, parsed);
  revalidatePath('/');
  return row;
}
