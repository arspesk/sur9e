// Pure fold: ChatTurnEvent stream → ordered render items for the transcript.
// Consecutive text-deltas merge into one markdown run, consecutive thinking
// chunks merge into one block, consecutive same-name tool calls group ×N.
// confirm-resolved flips its confirm item in place. `ui` (side-effect) and
// `done` (terminal marker) never render. No DOM, safe for server + vitest.

import type { ChatActionLink, ChatTurnEvent } from '@/lib/schemas/chat';

// Which gated action a confirm card stands for. Mirrors ConfirmKind in
// src/lib/server/chat/confirms.ts (kept as a local type so this pure,
// client-safe module never imports the server-only confirms store).
export type ConfirmActionKind =
  | 'start-job'
  | 'cancel-job'
  | 'create-offer-from-text'
  | 'set-status'
  | 'edit-report';

export type FoldedItem =
  | { kind: 'text'; markdown: string }
  | { kind: 'thinking'; text: string }
  | {
      kind: 'tools';
      name: string;
      count: number;
      status: 'running' | 'done' | 'error';
      detail?: string;
    }
  | { kind: 'stage'; label: string }
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

/** Internal accumulator — tracks start/done/error counts so a group's status
 * can be derived after out-of-order completions. `openIds` holds the provider
 * call ids of starts not yet closed, so a close event pairs to the exact call
 * it finishes (claude tool_result carries only the id, never the name). */
interface ToolAccum {
  kind: 'tool-accum';
  name: string;
  count: number;
  starts: number;
  dones: number;
  errors: number;
  detail?: string;
  openIds: Set<string>;
}

type Accum = Exclude<FoldedItem, { kind: 'tools' }> | ToolAccum;

/** Nearest-match-from-the-end scan (Array.prototype.findLast isn't in the
 * project's TS lib target). Returns the last element satisfying `pred`. */
function findLast<T>(arr: T[], pred: (v: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return arr[i];
  }
  return undefined;
}

export function foldEvents(events: ChatTurnEvent[]): FoldedItem[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const items: Accum[] = [];
  const last = () => items[items.length - 1];

  for (const event of sorted) {
    switch (event.type) {
      case 'text-delta': {
        const l = last();
        if (l?.kind === 'text') l.markdown += event.text;
        else items.push({ kind: 'text', markdown: event.text });
        break;
      }
      case 'thinking': {
        const l = last();
        if (l?.kind === 'thinking') l.text += event.text;
        else items.push({ kind: 'thinking', text: event.text });
        break;
      }
      case 'tool': {
        if (event.status === 'start') {
          const l = last();
          if (l?.kind === 'tool-accum' && l.name === event.name) {
            l.count += 1;
            l.starts += 1;
            if (event.id) l.openIds.add(event.id);
            if (event.detail) l.detail = event.detail;
          } else {
            items.push({
              kind: 'tool-accum',
              name: event.name,
              count: 1,
              starts: 1,
              dones: 0,
              errors: 0,
              detail: event.detail,
              openIds: event.id ? new Set([event.id]) : new Set(),
            });
          }
          break;
        }
        // done / error: resolve the open call it closes.
        const bump = (it: ToolAccum) => {
          if (event.status === 'done') it.dones += 1;
          else it.errors += 1;
          if (event.id) it.openIds.delete(event.id);
        };
        // 1) Pair by id — the only reliable match when the close event carries
        //    no name (claude tool_result) or tools ran in parallel.
        if (event.id) {
          const byId = findLast(
            items,
            it => it.kind === 'tool-accum' && it.openIds.has(event.id as string),
          );
          if (byId?.kind === 'tool-accum') {
            bump(byId);
            break;
          }
        }
        // 2) Fall back to the nearest still-running group of the same name.
        const byName = findLast(
          items,
          it =>
            it.kind === 'tool-accum' && it.name === event.name && it.dones + it.errors < it.starts,
        );
        if (byName?.kind === 'tool-accum') {
          bump(byName);
          break;
        }
        // 3) A close with no matching open — the CLI emitted the tool part
        //    only once, already finished (opencode `run --format json`). Show
        //    it as an already-resolved chip rather than dropping it.
        items.push({
          kind: 'tool-accum',
          name: event.name || 'tool',
          count: 1,
          starts: 1,
          dones: event.status === 'done' ? 1 : 0,
          errors: event.status === 'error' ? 1 : 0,
          detail: event.detail,
          openIds: new Set(),
        });
        break;
      }
      case 'stage':
        items.push({ kind: 'stage', label: event.label });
        break;
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

  return items.map(it =>
    it.kind === 'tool-accum'
      ? {
          kind: 'tools' as const,
          name: it.name,
          count: it.count,
          status:
            it.errors > 0
              ? ('error' as const)
              : it.dones >= it.starts
                ? ('done' as const)
                : ('running' as const),
          detail: it.detail,
        }
      : it,
  );
}
