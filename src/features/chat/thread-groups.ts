// Recency bucketing for thread lists, shared by the /chat sidebar and the
// bubble's session dropdown so the two surfaces group identically. Pure and
// `now`-injectable, so tests don't depend on the wall clock.

import type { Conversation } from '@/lib/schemas/chat';

const DAY_MS = 86_400_000;

export interface ThreadGroup {
  label: string;
  items: Conversation[];
}

/** Bucket threads by their `updatedAt` ISO timestamp into Today / Yesterday /
 * Previous 7 days / Older, relative to the viewer's local midnight. Empty
 * buckets are dropped so a header never renders without rows. Unparseable
 * timestamps fall into "Older" rather than disappearing. */
export function groupByRecency(list: Conversation[], now: number): ThreadGroup[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const todayStart = midnight.getTime();

  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const week: Conversation[] = [];
  const older: Conversation[] = [];

  for (const c of list) {
    const t = Date.parse(c.updatedAt);
    if (!Number.isFinite(t) || t < todayStart - 7 * DAY_MS) older.push(c);
    else if (t >= todayStart) today.push(c);
    else if (t >= todayStart - DAY_MS) yesterday.push(c);
    else week.push(c);
  }

  return [
    { label: 'Today', items: today },
    { label: 'Yesterday', items: yesterday },
    { label: 'Previous 7 days', items: week },
    { label: 'Older', items: older },
  ].filter(g => g.items.length > 0);
}
