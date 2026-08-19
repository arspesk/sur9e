// Pure fold: ChatTurnEvent stream → ordered render items for the transcript.
// Contiguous thinking / tool / stage events accumulate into ONE 'activity'
// item — the unified activity stream (issue #103 rework): one live line
// while the model works, one summary line at rest, the full step timeline on
// expand. Text-deltas, confirm cards, usage, and errors close the burst, so
// chronology is preserved (text between tool bursts yields separate
// activities). Consecutive text-deltas merge into one markdown run;
// confirm-resolved flips its confirm item in place. `ui` (side-effect) and
// `done` (terminal marker) never render. No DOM, safe for server + vitest.

import type { ChatActionLink, ChatTurnEvent } from '@/lib/schemas/chat';

// Which gated action a confirm card stands for. Mirrors ConfirmKind in
// src/lib/server/chat/confirms.ts (kept as a local type so this pure,
// client-safe module never imports the server-only confirms store).
export type ConfirmActionKind =
  | 'start-job'
  | 'start-workflow'
  | 'cancel-job'
  | 'cancel-workflow'
  | 'create-offer-from-text'
  | 'set-status'
  | 'update-offer'
  // Legacy, read-only: v0.4.x persisted confirm events with this kind before
  // issue #74 renamed the action to 'update-offer'. Never emitted anew — kept
  // so old data/chat.db rows still fold to a rendered (resolved) card instead
  // of failing ChatTurnEvent.safeParse and vanishing from the transcript.
  | 'edit-report';

/** One step in an activity's timeline. Tool entries are INDIVIDUAL calls
 * (never merged ×N) so each keeps its own detail and status; consecutive
 * thinking deltas merge into one entry until a non-thinking event lands. */
export type ActivityEntry =
  | { type: 'thinking'; text: string; ts?: number }
  | {
      type: 'tool';
      name: string;
      status: 'running' | 'done' | 'error';
      detail?: string;
      ts?: number;
    }
  | { type: 'stage'; label: string; ts?: number };

export type FoldedItem =
  | { kind: 'text'; markdown: string }
  | {
      kind: 'activity';
      /** running while any tool call is open; error when settled with a
       * failed call; done otherwise. */
      status: 'running' | 'done' | 'error';
      /** Tool calls + stages — thinking shows in the timeline but is not a
       * counted step. */
      steps: number;
      failed: number;
      entries: ActivityEntry[];
      /** Wall-clock span from event `ts` stamps; absent on events persisted
       * before the ts field existed (the summary then omits the duration). */
      startTs?: number;
      endTs?: number;
    }
  | {
      kind: 'confirm';
      token: string;
      summary: string;
      meta: string;
      // Matches ChatTurnEvent's confirm-resolved outcome enum exactly
      // (src/lib/schemas/chat.ts) — 'pending' is the pre-resolution default.
      outcome: 'pending' | 'approved' | 'cancelled' | 'expired';
      execution?: 'succeeded' | 'failed' | 'unchanged';
      message?: string;
      links?: ChatActionLink[];
      // The gated action this card confirms, when the confirm event carried it
      // — drives the action-specific resolved label. Absent on confirm events
      // persisted before the kind field existed (card falls back to generic).
      action?: ConfirmActionKind;
    }
  // costUsd mirrors ChatTurnEvent's usage.costUsd, which is nullable in the
  // committed schema (src/lib/schemas/chat.ts) — cost may be unknown mid-turn.
  | { kind: 'usage'; costUsd: number | null }
  | { kind: 'error'; message: string };

/** Internal tool entry — keeps the provider call id for close pairing; the
 * id is stripped from the public ActivityEntry in the final map. */
interface ToolEntryAccum {
  type: 'tool';
  name: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
  ts?: number;
  id?: string;
}

type EntryAccum = Exclude<ActivityEntry, { type: 'tool' }> | ToolEntryAccum;

interface ActivityAccum {
  kind: 'activity-accum';
  entries: EntryAccum[];
  minTs?: number;
  maxTs?: number;
}

type Accum = Exclude<FoldedItem, { kind: 'activity' }> | ActivityAccum;

/** Nearest-match-from-the-end scan (Array.prototype.findLast isn't in the
 * project's TS lib target). Returns the last element satisfying `pred`. */
function findLast<T>(arr: T[], pred: (v: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return arr[i];
  }
  return undefined;
}

function touchTs(a: ActivityAccum, ts: number | undefined): void {
  if (ts == null) return;
  a.minTs = a.minTs == null ? ts : Math.min(a.minTs, ts);
  a.maxTs = a.maxTs == null ? ts : Math.max(a.maxTs, ts);
}

/** Find the running tool entry (and its owning activity) a close event
 * pairs to — scanning items and entries from the end, like the old
 * group-level pairing did. */
function findOpenTool(
  items: Accum[],
  pred: (entry: ToolEntryAccum) => boolean,
): { activity: ActivityAccum; entry: ToolEntryAccum } | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== 'activity-accum') continue;
    const entry = findLast(
      it.entries,
      en => en.type === 'tool' && en.status === 'running' && pred(en as ToolEntryAccum),
    );
    if (entry) return { activity: it, entry: entry as ToolEntryAccum };
  }
  return undefined;
}

export function foldEvents(events: ChatTurnEvent[]): FoldedItem[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const items: Accum[] = [];
  const last = () => items[items.length - 1];
  /** The burst the next thinking/tool/stage event joins — the trailing
   * activity accum, or a fresh one when the burst was closed by text /
   * confirm / usage / error. */
  const activityAt = (): ActivityAccum => {
    const l = last();
    if (l?.kind === 'activity-accum') return l;
    const a: ActivityAccum = { kind: 'activity-accum', entries: [] };
    items.push(a);
    return a;
  };

  for (const event of sorted) {
    switch (event.type) {
      case 'text-delta': {
        const l = last();
        if (l?.kind === 'text') l.markdown += event.text;
        else items.push({ kind: 'text', markdown: event.text });
        break;
      }
      case 'thinking': {
        const a = activityAt();
        touchTs(a, event.ts);
        const lastEntry = a.entries[a.entries.length - 1];
        if (lastEntry?.type === 'thinking') lastEntry.text += event.text;
        else {
          a.entries.push({
            type: 'thinking',
            text: event.text,
            ...(event.ts != null ? { ts: event.ts } : {}),
          });
        }
        break;
      }
      case 'tool': {
        if (event.status === 'start') {
          const a = activityAt();
          touchTs(a, event.ts);
          a.entries.push({
            type: 'tool',
            name: event.name,
            status: 'running',
            detail: event.detail,
            ...(event.ts != null ? { ts: event.ts } : {}),
            ...(event.id ? { id: event.id } : {}),
          });
          break;
        }
        // done / error: resolve the open call it closes.
        // 1) Pair by id — the only reliable match when the close event carries
        //    no name (claude tool_result) or tools ran in parallel.
        // 2) Fall back to the nearest still-running entry of the same name.
        const hit =
          (event.id ? findOpenTool(items, en => en.id === event.id) : undefined) ??
          findOpenTool(items, en => en.name === event.name);
        if (hit) {
          hit.entry.status = event.status === 'done' ? 'done' : 'error';
          touchTs(hit.activity, event.ts);
          break;
        }
        // 3) A close with no matching open — the CLI emitted the tool part
        //    only once, already finished (opencode `run --format json`). Show
        //    it as an already-resolved step rather than dropping it.
        const a = activityAt();
        touchTs(a, event.ts);
        a.entries.push({
          type: 'tool',
          name: event.name || 'tool',
          status: event.status === 'done' ? 'done' : 'error',
          detail: event.detail,
          ...(event.ts != null ? { ts: event.ts } : {}),
        });
        break;
      }
      case 'stage': {
        const a = activityAt();
        touchTs(a, event.ts);
        a.entries.push({
          type: 'stage',
          label: event.label,
          ...(event.ts != null ? { ts: event.ts } : {}),
        });
        break;
      }
      case 'confirm':
        items.push({
          kind: 'confirm',
          token: event.token,
          summary: event.summary,
          meta: event.meta,
          outcome: 'pending',
          // Only set when the event actually carried a kind, so pre-migration
          // confirm events fold to the exact same shape as before.
          ...(event.kind ? { action: event.kind } : {}),
        });
        break;
      case 'confirm-resolved': {
        for (const it of items) {
          if (it.kind === 'confirm' && it.token === event.token) {
            it.outcome = event.outcome;
            if (event.execution) it.execution = event.execution;
            if (event.message) it.message = event.message;
            if (event.links) it.links = event.links;
          }
        }
        break;
      }
      case 'usage':
        items.push({ kind: 'usage', costUsd: event.costUsd });
        break;
      case 'error':
        items.push({ kind: 'error', message: event.message });
        break;
      case 'ui':
      case 'done':
        break;
    }
  }

  return items.map(it => {
    if (it.kind !== 'activity-accum') return it;
    const running = it.entries.some(en => en.type === 'tool' && en.status === 'running');
    const failed = it.entries.filter(en => en.type === 'tool' && en.status === 'error').length;
    return {
      kind: 'activity' as const,
      status: running ? ('running' as const) : failed > 0 ? ('error' as const) : ('done' as const),
      steps: it.entries.filter(en => en.type !== 'thinking').length,
      failed,
      entries: it.entries.map(en =>
        en.type === 'tool'
          ? {
              type: 'tool' as const,
              name: en.name,
              status: en.status,
              detail: en.detail,
              ...(en.ts != null ? { ts: en.ts } : {}),
            }
          : en,
      ),
      ...(it.minTs != null ? { startTs: it.minTs } : {}),
      ...(it.maxTs != null ? { endTs: it.maxTs } : {}),
    };
  });
}
