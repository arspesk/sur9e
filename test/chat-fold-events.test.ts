import { describe, expect, it } from 'vitest';
import { foldEvents } from '@/features/chat/fold-events';
import { ChatTurnEvent } from '@/lib/schemas/chat';

// Plain `Omit<ChatTurnEvent, 'seq'>` doesn't distribute over the
// discriminated union (Pick/Omit key sets collapse to the members common to
// every branch), which drops each variant's own fields. Distribute manually
// so the test fixture keeps per-branch type checking.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

const e = (partial: DistributiveOmit<ChatTurnEvent, 'seq'>, seq: number) =>
  ({ seq, ...partial }) as ChatTurnEvent;

describe('foldEvents', () => {
  it('accumulates consecutive text-deltas into one text item', () => {
    const items = foldEvents([
      e({ type: 'text-delta', text: 'Hel' }, 1),
      e({ type: 'text-delta', text: 'lo ' }, 2),
      e({ type: 'text-delta', text: 'there' }, 3),
    ]);
    expect(items).toEqual([{ kind: 'text', markdown: 'Hello there' }]);
  });

  it('sorts by seq before folding (SSE replay may interleave)', () => {
    const items = foldEvents([
      e({ type: 'text-delta', text: 'world' }, 2),
      e({ type: 'text-delta', text: 'hello ' }, 1),
    ]);
    expect(items).toEqual([{ kind: 'text', markdown: 'hello world' }]);
  });

  it('folds contiguous thinking, tool, and stage events into ONE activity item', () => {
    const items = foldEvents([
      e({ type: 'thinking', text: 'planning' }, 1),
      e({ type: 'tool', name: 'get_tracker', status: 'start' }, 2),
      e({ type: 'tool', name: 'get_tracker', status: 'done' }, 3),
      e({ type: 'stage', label: 'reading tracker' }, 4),
      e({ type: 'tool', name: 'get_report', status: 'start', detail: '#1841' }, 5),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'activity',
      status: 'running',
      steps: 3, // 2 tool calls + 1 stage — thinking is not a step
      failed: 0,
    });
    const activity = items[0] as Extract<(typeof items)[number], { kind: 'activity' }>;
    expect(activity.entries).toEqual([
      { type: 'thinking', text: 'planning' },
      { type: 'tool', name: 'get_tracker', status: 'done', detail: undefined },
      { type: 'stage', label: 'reading tracker' },
      { type: 'tool', name: 'get_report', status: 'running', detail: '#1841' },
    ]);
  });

  it('keeps every tool call as its own entry — repeated names never merge into ×N', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'get_report', status: 'start', detail: '#1841' }, 1),
      e({ type: 'tool', name: 'get_report', status: 'done' }, 2),
      e({ type: 'tool', name: 'get_report', status: 'start', detail: '#1852' }, 3),
    ]);
    expect(items).toHaveLength(1);
    const activity = items[0] as Extract<(typeof items)[number], { kind: 'activity' }>;
    expect(activity.entries).toEqual([
      { type: 'tool', name: 'get_report', status: 'done', detail: '#1841' },
      { type: 'tool', name: 'get_report', status: 'running', detail: '#1852' },
    ]);
  });

  it('text closes the burst; a later tool done still resolves its entry in the earlier activity', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'get_report', status: 'start' }, 1),
      e({ type: 'text-delta', text: 'Reading…' }, 2),
      e({ type: 'tool', name: 'get_report', status: 'done' }, 3),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'activity', status: 'done', steps: 1 });
    expect(items[1]).toEqual({ kind: 'text', markdown: 'Reading…' });
  });

  it('pairs a close event to its open call by id (name-less claude tool_result)', () => {
    // Claude's tool_result carries only the id, never the name — id pairing is
    // the only way the running entry can resolve.
    const items = foldEvents([
      e({ type: 'tool', name: 'WebFetch', status: 'start', id: 'toolu_1' }, 1),
      e({ type: 'text-delta', text: 'fetching…' }, 2),
      e({ type: 'tool', name: '', status: 'done', id: 'toolu_1' }, 3),
    ]);
    expect(items[0]).toMatchObject({ kind: 'activity', status: 'done' });
    const activity = items[0] as Extract<(typeof items)[number], { kind: 'activity' }>;
    expect(activity.entries[0]).toMatchObject({ type: 'tool', name: 'WebFetch', status: 'done' });
  });

  it('resolves the correct entry when two different tools are open in parallel (id match)', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'Read', status: 'start', id: 'a' }, 1),
      e({ type: 'tool', name: 'Grep', status: 'start', id: 'b' }, 2),
      // Grep finishes first — id pairing must resolve Grep, not Read.
      e({ type: 'tool', name: '', status: 'done', id: 'b' }, 3),
    ]);
    const activity = items[0] as Extract<(typeof items)[number], { kind: 'activity' }>;
    expect(activity.entries).toEqual([
      { type: 'tool', name: 'Read', status: 'running', detail: undefined },
      { type: 'tool', name: 'Grep', status: 'done', detail: undefined },
    ]);
    expect(activity.status).toBe('running');
  });

  it('materializes an already-resolved entry when a close has no matching open (opencode completed-only)', () => {
    // `opencode run --format json` emits a tool part once, already completed —
    // there is no preceding start, so the folder must still surface the step.
    const items = foldEvents([e({ type: 'tool', name: 'bash', status: 'done', id: 'call_1' }, 1)]);
    expect(items[0]).toMatchObject({ kind: 'activity', status: 'done', steps: 1, failed: 0 });
  });

  it('a tool error marks the activity status error and counts toward failed', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'get_report', status: 'start' }, 1),
      e({ type: 'tool', name: 'get_report', status: 'done' }, 2),
      e({ type: 'tool', name: 'start_job', status: 'start' }, 3),
      e({ type: 'tool', name: 'start_job', status: 'error' }, 4),
    ]);
    expect(items[0]).toMatchObject({ kind: 'activity', status: 'error', steps: 2, failed: 1 });
  });

  it('a confirm card breaks the burst into two activities', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'get_tracker', status: 'start' }, 1),
      e({ type: 'tool', name: 'get_tracker', status: 'done' }, 2),
      e({ type: 'confirm', token: 'tok', summary: 'Set status?', meta: '' }, 3),
      e({ type: 'tool', name: 'set_status', status: 'start' }, 4),
    ]);
    expect(items.map(i => i.kind)).toEqual(['activity', 'confirm', 'activity']);
  });

  it('a tool between thinking runs splits the thinking into two entries', () => {
    const items = foldEvents([
      e({ type: 'thinking', text: 'first ' }, 1),
      e({ type: 'thinking', text: 'thought' }, 2),
      e({ type: 'tool', name: 'get_tracker', status: 'done' }, 3),
      e({ type: 'thinking', text: 'second thought' }, 4),
    ]);
    const activity = items[0] as Extract<(typeof items)[number], { kind: 'activity' }>;
    expect(activity.entries.map(en => en.type)).toEqual(['thinking', 'tool', 'thinking']);
    expect(activity.entries[0]).toMatchObject({ text: 'first thought' });
    expect(activity.entries[2]).toMatchObject({ text: 'second thought' });
  });

  it('carries event timestamps onto entries and derives the activity span', () => {
    const items = foldEvents([
      e({ type: 'thinking', text: 'hmm', ts: 1000 }, 1),
      e({ type: 'tool', name: 'get_tracker', status: 'start', ts: 3000 }, 2),
      e({ type: 'tool', name: 'get_tracker', status: 'done', ts: 42000 }, 3),
    ]);
    const activity = items[0] as Extract<(typeof items)[number], { kind: 'activity' }>;
    expect(activity.startTs).toBe(1000);
    expect(activity.endTs).toBe(42000);
    expect(activity.entries[0]).toMatchObject({ type: 'thinking', ts: 1000 });
  });

  it('derives no span when events carry no timestamps (pre-migration data)', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'get_tracker', status: 'start' }, 1),
      e({ type: 'tool', name: 'get_tracker', status: 'done' }, 2),
    ]);
    const activity = items[0] as Extract<(typeof items)[number], { kind: 'activity' }>;
    expect(activity.startTs).toBeUndefined();
    expect(activity.endTs).toBeUndefined();
  });

  it('confirm-resolved flips the matching confirm item by token', () => {
    const items = foldEvents([
      e(
        {
          type: 'confirm',
          token: 'tok1',
          summary: 'Start evaluation for #12',
          meta: 'claude·sonnet · ~$0.30',
        },
        1,
      ),
      e({ type: 'confirm-resolved', token: 'tok1', outcome: 'approved' }, 2),
    ]);
    expect(items).toEqual([
      {
        kind: 'confirm',
        token: 'tok1',
        summary: 'Start evaluation for #12',
        meta: 'claude·sonnet · ~$0.30',
        outcome: 'approved',
      },
    ]);
  });

  it('carries the execution result that qualifies an approved confirm', () => {
    const items = foldEvents([
      e(
        {
          type: 'confirm',
          token: 'tok-cancel',
          summary: 'Cancel job',
          meta: 'job abc',
          kind: 'cancel-job',
        },
        1,
      ),
      e(
        {
          type: 'confirm-resolved',
          token: 'tok-cancel',
          outcome: 'approved',
          execution: 'unchanged',
        },
        2,
      ),
    ]);
    expect(items[0]).toMatchObject({
      kind: 'confirm',
      outcome: 'approved',
      execution: 'unchanged',
      action: 'cancel-job',
    });
  });

  it('carries a durable result message and offer link onto the resolved card', () => {
    const items = foldEvents([
      e(
        {
          type: 'confirm',
          token: 'tok-offer',
          summary: 'Create offer',
          meta: 'local tracker write',
          kind: 'create-offer-from-text',
        },
        1,
      ),
      e(
        {
          type: 'confirm-resolved',
          token: 'tok-offer',
          outcome: 'approved',
          execution: 'succeeded',
          message: 'Offer #42 created. Screening and evaluation started.',
          links: [{ label: 'Offer #42', href: '/report/42' }],
        },
        2,
      ),
    ]);
    expect(items[0]).toMatchObject({
      kind: 'confirm',
      message: 'Offer #42 created. Screening and evaluation started.',
      links: [{ label: 'Offer #42', href: '/report/42' }],
    });
  });

  it('confirm-resolved with an expired outcome flips the matching confirm item', () => {
    const items = foldEvents([
      e(
        {
          type: 'confirm',
          token: 'tok2',
          summary: 'Send outreach message',
          meta: 'claude·sonnet · ~$0.05',
        },
        1,
      ),
      e({ type: 'confirm-resolved', token: 'tok2', outcome: 'expired' }, 2),
    ]);
    expect(items).toEqual([
      {
        kind: 'confirm',
        token: 'tok2',
        summary: 'Send outreach message',
        meta: 'claude·sonnet · ~$0.05',
        outcome: 'expired',
      },
    ]);
  });

  it('accepts a legacy edit-report confirm kind (pre-0.5 persisted events) and folds its resolved label', () => {
    // v0.4.x emitted 'edit-report' for this write before issue #74 renamed it
    // to 'update-offer'; updates never touch data/, so existing users' chat.db
    // still holds these persisted events. ChatTurnEvent.parse (the same call
    // store.ts/message-view.tsx use at the read boundary) must keep accepting
    // the literal, or these old cards would fail to parse and silently vanish
    // from the transcript on reload instead of rendering their resolved
    // 'Report updated' label (src/features/chat/confirm-card.tsx).
    const persisted = [
      ChatTurnEvent.parse({
        seq: 1,
        type: 'confirm',
        token: 'tok-legacy',
        summary: 'Edit report #12',
        meta: 'report write · no AI spend',
        kind: 'edit-report',
      }),
      ChatTurnEvent.parse({
        seq: 2,
        type: 'confirm-resolved',
        token: 'tok-legacy',
        outcome: 'approved',
      }),
    ];
    const items = foldEvents(persisted);
    expect(items).toEqual([
      {
        kind: 'confirm',
        token: 'tok-legacy',
        summary: 'Edit report #12',
        meta: 'report write · no AI spend',
        outcome: 'approved',
        action: 'edit-report',
      },
    ]);
  });

  it('stage/thinking join the activity; usage/error pass through; ui and done are dropped', () => {
    const items = foldEvents([
      e({ type: 'stage', label: 'reading tracker' }, 1),
      e({ type: 'thinking', text: 'hmm ' }, 2),
      e({ type: 'thinking', text: 'okay' }, 3),
      e({ type: 'ui', action: 'navigate', path: '/report/3' }, 4),
      e({ type: 'usage', costUsd: 0.14, inputTokens: 100, outputTokens: 20, model: 'm' }, 5),
      e({ type: 'error', message: 'boom' }, 6),
      e({ type: 'done', messageId: 'm1' }, 7),
    ]);
    expect(items[0]).toMatchObject({ kind: 'activity', steps: 1 }); // the stage
    const activity = items[0] as Extract<(typeof items)[number], { kind: 'activity' }>;
    expect(activity.entries).toEqual([
      { type: 'stage', label: 'reading tracker' },
      { type: 'thinking', text: 'hmm okay' },
    ]);
    expect(items.slice(1)).toEqual([
      { kind: 'usage', costUsd: 0.14 },
      { kind: 'error', message: 'boom' },
    ]);
  });

  it('passes through a null costUsd on the usage item (costUsd is nullable in the schema)', () => {
    const items = foldEvents([
      e({ type: 'usage', costUsd: null, inputTokens: null, outputTokens: null, model: null }, 1),
    ]);
    expect(items).toEqual([{ kind: 'usage', costUsd: null }]);
  });
});
