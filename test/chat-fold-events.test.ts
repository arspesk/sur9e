import { describe, expect, it } from 'vitest';
import { foldEvents } from '@/features/chat/fold-events';
import type { ChatTurnEvent } from '@/lib/schemas/chat';

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

  it('groups consecutive same-name tool calls with ×N count and terminal status', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'get_report', status: 'start' }, 1),
      e({ type: 'tool', name: 'get_report', status: 'done' }, 2),
      e({ type: 'tool', name: 'get_report', status: 'start' }, 3),
      e({ type: 'tool', name: 'get_report', status: 'done' }, 4),
      e({ type: 'tool', name: 'get_tracker', status: 'start' }, 5),
    ]);
    expect(items).toEqual([
      { kind: 'tools', name: 'get_report', count: 2, status: 'done', detail: undefined },
      { kind: 'tools', name: 'get_tracker', count: 1, status: 'running', detail: undefined },
    ]);
  });

  it('a tool done arriving after interleaved text closes the earlier group', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'get_report', status: 'start' }, 1),
      e({ type: 'text-delta', text: 'Reading…' }, 2),
      e({ type: 'tool', name: 'get_report', status: 'done' }, 3),
    ]);
    expect(items[0]).toEqual({
      kind: 'tools',
      name: 'get_report',
      count: 1,
      status: 'done',
      detail: undefined,
    });
    expect(items[1]).toEqual({ kind: 'text', markdown: 'Reading…' });
  });

  it('pairs a close event to its open call by id (name-less claude tool_result)', () => {
    // Claude's tool_result carries only the id, never the name — id pairing is
    // the only way the running chip can resolve.
    const items = foldEvents([
      e({ type: 'tool', name: 'WebFetch', status: 'start', id: 'toolu_1' }, 1),
      e({ type: 'text-delta', text: 'fetching…' }, 2),
      e({ type: 'tool', name: '', status: 'done', id: 'toolu_1' }, 3),
    ]);
    expect(items[0]).toMatchObject({ kind: 'tools', name: 'WebFetch', count: 1, status: 'done' });
  });

  it('resolves the correct chip when two different tools are open in parallel (id match)', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'Read', status: 'start', id: 'a' }, 1),
      e({ type: 'tool', name: 'Grep', status: 'start', id: 'b' }, 2),
      // Grep finishes first — id pairing must resolve Grep, not Read.
      e({ type: 'tool', name: '', status: 'done', id: 'b' }, 3),
    ]);
    expect(items.find(i => i.kind === 'tools' && i.name === 'Grep')).toMatchObject({
      status: 'done',
    });
    expect(items.find(i => i.kind === 'tools' && i.name === 'Read')).toMatchObject({
      status: 'running',
    });
  });

  it('materializes an already-resolved chip when a close has no matching open (opencode completed-only)', () => {
    // `opencode run --format json` emits a tool part once, already completed —
    // there is no preceding start, so the folder must still surface a ✓ chip.
    const items = foldEvents([e({ type: 'tool', name: 'bash', status: 'done', id: 'call_1' }, 1)]);
    expect(items).toEqual([
      { kind: 'tools', name: 'bash', count: 1, status: 'done', detail: undefined },
    ]);
  });

  it('a tool error marks the group status error', () => {
    const items = foldEvents([
      e({ type: 'tool', name: 'start_job', status: 'start' }, 1),
      e({ type: 'tool', name: 'start_job', status: 'error' }, 2),
    ]);
    expect(items[0]).toMatchObject({ kind: 'tools', name: 'start_job', status: 'error' });
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

  it('thinking runs merge; stage/usage/error pass through; ui and done are dropped', () => {
    const items = foldEvents([
      e({ type: 'stage', label: 'reading tracker' }, 1),
      e({ type: 'thinking', text: 'hmm ' }, 2),
      e({ type: 'thinking', text: 'okay' }, 3),
      e({ type: 'ui', action: 'navigate', path: '/report/3' }, 4),
      e({ type: 'usage', costUsd: 0.14, inputTokens: 100, outputTokens: 20, model: 'm' }, 5),
      e({ type: 'error', message: 'boom' }, 6),
      e({ type: 'done', messageId: 'm1' }, 7),
    ]);
    expect(items).toEqual([
      { kind: 'stage', label: 'reading tracker' },
      { kind: 'thinking', text: 'hmm okay' },
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
