import type { Editor } from '@tiptap/core';

export interface SlashContext {
  num?: number;
  status?: string;
  filename?: string;
}

export interface SlashItem {
  id: string;
  group: string;
  icon?: string; // SVG markup string OR lucide icon name
  /**
   * Optional CSS color value applied to the icon (overrides currentColor).
   * Lets per-item icons render in a distinguishing accent — e.g., one
   * color per AI generator mode so the slash menu reads at a glance.
   */
  tint?: string;
  label: string;
  hint?: string;
  keywords?: string[];
  command: (editor: Editor, ctx: SlashContext) => void;
  /**
   * Optional context-aware visibility check. When defined and the editor
   * passes a SlashContext that the item rejects, the item is filtered out
   * of the slash menu. Used by AI generator modes to limit themselves to
   * the report editor (where ctx.num is set) and hide on /profile.
   */
  shouldShow?: (ctx: SlashContext) => boolean;
}

const items = new Map<string, SlashItem>();

export function registerSlashItem(item: SlashItem): void {
  if (items.has(item.id)) {
    throw new Error(`Duplicate slash-item id: ${item.id}`);
  }
  items.set(item.id, item);
}

export function unregisterSlashItem(id: string): void {
  items.delete(id);
}

export function getSlashItems(ctx?: SlashContext): SlashItem[] {
  const all = Array.from(items.values());
  if (!ctx) return all;
  return all.filter(i => (i.shouldShow ? i.shouldShow(ctx) : true));
}

/** True when every char of `q` appears in `text` in order (loose fuzzy match). */
function isSubsequence(q: string, text: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < q.length; ti++) {
    if (text[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Relevance score for one field against the query. Higher is better; -1 means
 * no match. Ranked so the most literal match wins: exact > prefix >
 * word-boundary prefix > substring > subsequence. Subsequence is the loose
 * fallback so typos / abbreviations ("ordlist") still surface something.
 */
function scoreField(q: string, field: string): number {
  if (field === q) return 100;
  if (field.startsWith(q)) return 80;
  if (field.split(/[\s-]+/).some(w => w.startsWith(q))) return 60;
  if (field.includes(q)) return 40;
  if (isSubsequence(q, field)) return 20;
  return -1;
}

/** Best score for an item across its label + keywords. -1 means no match. */
function scoreSlashItem(q: string, item: SlashItem): number {
  let best = scoreField(q, item.label.toLowerCase());
  // Label matches outrank keyword matches at the same tier so "Heading 1"
  // beats an item that merely lists "heading" as a synonym.
  for (const k of item.keywords ?? []) {
    const s = scoreField(q, k.toLowerCase());
    if (s > 0) best = Math.max(best, s - 5);
  }
  return best;
}

export function matchSlashItems(query: string, ctx?: SlashContext): SlashItem[] {
  const visible = getSlashItems(ctx);
  const q = query.trim().toLowerCase();
  if (!q) return visible;
  // Score every visible item, drop non-matches, then sort best-first. The sort
  // is stable on equal scores (preserves registration order), and the first
  // element becomes the auto-highlighted suggestion in the slash menu.
  return visible
    .map((item, idx) => ({ item, idx, score: scoreSlashItem(q, item) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map(x => x.item);
}

/** Test-only — clears the registry between vitest runs. */
export function _resetSlashRegistryForTests(): void {
  items.clear();
}
