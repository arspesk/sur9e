// test/unit/chat/confirm-persistence.test.tsx
//
// Regression for the confirm-card resolution-persistence bug: a turn writes
// its events_json once (at 'done'), but the user clicks Approve/Cancel on the
// inline confirm card AFTER that — so the confirm-resolved event only ever
// reached the live SSE stream, never the stored message. On reload foldEvents
// re-processed the persisted events, saw the original pending confirm, and
// re-armed Start/Cancel buttons for an action that already ran.
//
// These tests drive the real resolveConfirm against a real chat.db and prove
// the resolution now lands in the owning message's events_json, survives a
// reload through foldEvents, and re-renders as a resolved (button-less) card.
//
// Pattern B (mirrors confirms.test.ts): tmpdir fixture + resetModules +
// dynamic import, with turn-runner + jobs/runner mocked so no live turn or
// real CLI spawn is needed. The chat store itself is NOT mocked — the whole
// point is exercising the persisted-events round-trip.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmCard } from '@/features/chat/confirm-card';
import { foldEvents } from '@/features/chat/fold-events';
import { ChatTurnEvent } from '@/lib/schemas/chat';

// ConfirmCard now calls useQueryClient (it invalidates the conversation cache
// on resolve so a close/reopen reflects the persisted outcome), so it must
// render under a QueryClientProvider. A fresh, retry-off client per render
// keeps the two card-render assertions isolated.
function renderCard(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const emitTurnEventMock = vi.fn();
const spawnJobMock = vi.fn();

vi.mock('@/lib/server/chat/turn-runner', () => ({ emitTurnEvent: emitTurnEventMock }));
vi.mock('@/lib/server/jobs/runner', () => ({ spawnJob: spawnJobMock }));

const APPLICATIONS_MD = [
  '# Applications Tracker',
  '',
  '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes |',
  '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- |',
  '| 1001 | 2026-05-15 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     |',
  '',
].join('\n');

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'chat-confirm-persist-'));
  mkdirSync(join(root, 'data/jobs'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), APPLICATIONS_MD, 'utf-8');
  // startJob's first-run preflight refuses to queue without cv.md + profile.yml.
  mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
  writeFileSync(join(root, 'inputs/personalization/cv.md'), '# CV\n', 'utf-8');
  writeFileSync(join(root, 'inputs/personalization/profile.yml'), 'name: Test\n', 'utf-8');
  return root;
}

async function flushImmediate(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

function hasType(e: unknown, type: string): e is Record<string, unknown> {
  return typeof e === 'object' && e !== null && (e as { type?: unknown }).type === type;
}

/** Mirror message-view.tsx's parseTurnEvents: re-validate each persisted event
 * through ChatTurnEvent and drop what doesn't parse — the exact reload path. */
function reloadEvents(raw: unknown[] | null): ChatTurnEvent[] {
  const out: ChatTurnEvent[] = [];
  for (const e of raw ?? []) {
    const parsed = ChatTurnEvent.safeParse(e);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

type ConfirmsModule = typeof import('@/lib/server/chat/confirms');
type StoreModule = typeof import('@/lib/server/chat/store');
type DbModule = typeof import('@/lib/server/chat/db');

describe('confirm resolution persists to the owning message', () => {
  let root: string;
  let confirms: ConfirmsModule;
  let store: StoreModule;
  let db: DbModule;

  beforeEach(async () => {
    root = seedRoot();
    vi.resetModules();
    confirms = await import('@/lib/server/chat/confirms');
    store = await import('@/lib/server/chat/store');
    db = await import('@/lib/server/chat/db');
    emitTurnEventMock.mockReset();
    spawnJobMock.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await flushImmediate();
    rmSync(root, { recursive: true, force: true });
  });

  /** Park a start-job confirm, then persist the assistant message that owns it
   * exactly as the turn runner does at 'done' — its events carry the confirm
   * event (kind included) but no resolution yet. Returns { conversationId,
   * token }. */
  function seedTurn(): { conversationId: string; token: string } {
    const conversation = store.createConversation(root);
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'start-job',
      payload: { kind: 'evaluate', params: { num: 1001 } },
      summary: 'Start outreach draft for offer #1001',
      meta: 'claude · claude-sonnet-4-6 · ~2 min',
    });
    store.appendMessage(root, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'On it — want me to start that?',
      events: [
        { seq: 1, type: 'text-delta', text: 'On it.' },
        {
          seq: 2,
          type: 'confirm',
          token,
          summary: 'Start outreach draft for offer #1001',
          meta: 'claude · claude-sonnet-4-6 · ~2 min',
          kind: 'start-job',
        },
      ],
    });
    return { conversationId: conversation.id, token };
  }

  it('approve: the started outcome lands in events_json and re-renders as job-started, no buttons', async () => {
    const { conversationId, token } = seedTurn();

    const res = await confirms.resolveConfirm(root, token, true);
    expect(res.outcome).toBe('approved');

    // Reload from disk — the persisted events now carry the confirm-resolved.
    const [msg] = store.listMessages(root, conversationId);
    expect(
      (msg.events ?? []).some(e => hasType(e, 'confirm-resolved') && e.outcome === 'approved'),
    ).toBe(true);

    // foldEvents over the reloaded, re-validated events yields a resolved card.
    const confirm = foldEvents(reloadEvents(msg.events)).find(i => i.kind === 'confirm');
    expect(confirm).toMatchObject({
      kind: 'confirm',
      outcome: 'approved',
      action: 'start-job',
      message: 'Evaluation started for offer #1001.',
      links: [{ label: 'Offer #1001', href: '/report/1001' }],
    });
    if (confirm?.kind !== 'confirm') throw new Error('expected a confirm item');

    const { getByText, getByRole, queryByRole } = renderCard(
      <ConfirmCard
        token={confirm.token}
        summary={confirm.summary}
        meta={confirm.meta}
        outcome={confirm.outcome}
        action={confirm.action}
        message={confirm.message}
        links={confirm.links}
      />,
    );
    expect(getByText('✓ Started — running in the jobs strip')).toBeTruthy();
    expect(getByText('Evaluation started for offer #1001.')).toBeTruthy();
    expect(getByRole('link', { name: 'Offer #1001' })).toHaveAttribute('href', '/report/1001');
    expect(queryByRole('button')).toBeNull();
  });

  it('cancel: the cancelled outcome persists and re-renders as cancelled, no buttons', async () => {
    const { conversationId, token } = seedTurn();

    const res = await confirms.resolveConfirm(root, token, false);
    expect(res.outcome).toBe('cancelled');

    const [msg] = store.listMessages(root, conversationId);
    expect(
      (msg.events ?? []).some(e => hasType(e, 'confirm-resolved') && e.outcome === 'cancelled'),
    ).toBe(true);

    const confirm = foldEvents(reloadEvents(msg.events)).find(i => i.kind === 'confirm');
    expect(confirm).toMatchObject({ kind: 'confirm', outcome: 'cancelled' });
    if (confirm?.kind !== 'confirm') throw new Error('expected a confirm item');

    const { getByText, queryByRole } = renderCard(
      <ConfirmCard
        token={confirm.token}
        summary={confirm.summary}
        meta={confirm.meta}
        outcome={confirm.outcome}
        action={confirm.action}
      />,
    );
    expect(getByText('✕ Cancelled')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('is idempotent: a stale second resolve never overwrites the recorded outcome', async () => {
    const { conversationId, token } = seedTurn();

    await confirms.resolveConfirm(root, token, true); // approved persisted
    // A late/stale click: the token is already consumed, so it resolves to
    // expired — which must NOT clobber the approved state on the message.
    const second = await confirms.resolveConfirm(root, token, false);
    expect(second.outcome).toBe('expired');

    const [msg] = store.listMessages(root, conversationId);
    const resolutions = (msg.events ?? []).filter(e => hasType(e, 'confirm-resolved'));
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].outcome).toBe('approved');
  });

  it('a resolve whose owning message is not (yet) persisted is a harmless no-op', async () => {
    // The live turn is still streaming: no assistant message on disk yet. The
    // live SSE event carries the resolution; persistence simply finds no owner
    // and does nothing (the turn will persist the full events at 'done').
    const conversation = store.createConversation(root);
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'set-status',
      payload: { num: 1001, status: 'applied' },
      summary: 'Set offer #1001 status to "applied"',
      meta: 'tracker write · no AI spend',
    });

    const res = await confirms.resolveConfirm(root, token, true);
    expect(res.outcome).toBe('approved');
    // No assistant message existed, so listMessages is empty and nothing threw.
    expect(store.listMessages(root, conversation.id)).toHaveLength(0);
  });

  it('appends a start-job confirm after the resolved parent with monotonic sequence and reload order', () => {
    const conversation = store.createConversation(root);
    const parentToken = 'parent-confirm-token';
    const childToken = 'child-confirm-token';
    store.appendMessage(root, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Status change?',
      events: [
        {
          seq: 4,
          type: 'confirm',
          token: parentToken,
          summary: 'Set offer #1001 status to "interview"',
          meta: 'tracker write · no AI spend',
          kind: 'set-status',
        },
        { seq: 8, type: 'stage', label: 'Status ready' },
      ],
    });

    expect(store.appendConfirmResolution(root, parentToken, 'approved', 'succeeded')).toBe(true);
    expect(
      store.appendConfirmAfter(root, parentToken, {
        token: childToken,
        summary: 'Start interview preparation for offer #1001',
        meta: 'claude · claude-sonnet-4-6 · ~7–15 min',
      }),
    ).toBe(true);

    const [message] = store.listMessages(root, conversation.id);
    const events = reloadEvents(message.events);
    expect(events.map(event => event.seq)).toEqual([4, 8, 9, 10]);
    expect(events.at(-1)).toEqual({
      seq: 10,
      type: 'confirm',
      token: childToken,
      summary: 'Start interview preparation for offer #1001',
      meta: 'claude · claude-sonnet-4-6 · ~7–15 min',
      kind: 'start-job',
    });
    expect(foldEvents(events).filter(item => item.kind === 'confirm')).toEqual([
      expect.objectContaining({
        kind: 'confirm',
        token: parentToken,
        outcome: 'approved',
        action: 'set-status',
      }),
      expect.objectContaining({
        kind: 'confirm',
        token: childToken,
        outcome: 'pending',
        action: 'start-job',
      }),
    ]);
  });

  it('ignores invalid sibling sequences when appending reload-valid resolution and child events', () => {
    const conversation = store.createConversation(root);
    const parentToken = 'mixed-sequence-parent';
    const childToken = 'mixed-sequence-child';
    const fractionalSibling = { seq: 99.5, type: 'stage', label: 'fractional sequence' };
    const negativeSibling = { seq: -7, type: 'stage', label: 'negative sequence' };
    store.appendMessage(root, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Status change?',
      events: [
        {
          seq: 2,
          type: 'confirm',
          token: parentToken,
          summary: 'Set offer #1001 status to "interview"',
          meta: 'tracker write · no AI spend',
          kind: 'set-status',
        },
        fractionalSibling,
        negativeSibling,
        { seq: 6, type: 'stage', label: 'valid sequence' },
      ],
    });

    expect(store.appendConfirmResolution(root, parentToken, 'approved', 'succeeded')).toBe(true);
    expect(
      store.appendConfirmAfter(root, parentToken, {
        token: childToken,
        summary: 'Start interview prep for offer #1001',
        meta: 'claude · claude-sonnet-4-6 · ~5–10 min',
      }),
    ).toBe(true);

    const [message] = store.listMessages(root, conversation.id);
    expect(message.events).toEqual(expect.arrayContaining([fractionalSibling, negativeSibling]));
    const events = reloadEvents(message.events);
    expect(events.map(event => event.seq)).toEqual([2, 6, 7, 8]);
    expect(foldEvents(events).filter(item => item.kind === 'confirm')).toEqual([
      expect.objectContaining({ token: parentToken, outcome: 'approved' }),
      expect.objectContaining({ token: childToken, outcome: 'pending', action: 'start-job' }),
    ]);
  });

  it('does not let a malformed matching resolution satisfy idempotency', () => {
    const conversation = store.createConversation(root);
    const parentToken = 'malformed-resolution-parent';
    const childToken = 'malformed-resolution-child';
    const malformedResolution = {
      seq: 2,
      type: 'confirm-resolved',
      token: parentToken,
      outcome: 'approved',
      execution: 'not-a-valid-execution',
    };
    store.appendMessage(root, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Status change?',
      events: [
        {
          seq: 1,
          type: 'confirm',
          token: parentToken,
          summary: 'Set offer #1001 status to "offer"',
          meta: 'tracker write · no AI spend',
          kind: 'set-status',
        },
        malformedResolution,
      ],
    });

    expect(store.appendConfirmResolution(root, parentToken, 'approved', 'succeeded')).toBe(true);
    expect(
      store.appendConfirmAfter(root, parentToken, {
        token: childToken,
        summary: 'Start negotiation strategy for offer #1001',
        meta: 'claude · claude-sonnet-4-6 · ~5–10 min',
      }),
    ).toBe(true);

    const [message] = store.listMessages(root, conversation.id);
    expect(message.events).toContainEqual(malformedResolution);
    const events = reloadEvents(message.events);
    expect(events).toEqual([
      expect.objectContaining({ seq: 1, type: 'confirm', token: parentToken }),
      expect.objectContaining({
        seq: 2,
        type: 'confirm-resolved',
        token: parentToken,
        outcome: 'approved',
        execution: 'succeeded',
      }),
      expect.objectContaining({ seq: 3, type: 'confirm', token: childToken }),
    ]);
    expect(foldEvents(events).filter(item => item.kind === 'confirm')).toEqual([
      expect.objectContaining({ token: parentToken, outcome: 'approved' }),
      expect.objectContaining({ token: childToken, outcome: 'pending', action: 'start-job' }),
    ]);
  });

  it('is idempotent when the exact child token is already appended', () => {
    const conversation = store.createConversation(root);
    const parentToken = 'parent-idempotent';
    const child = {
      token: 'child-idempotent',
      summary: 'Start negotiation prep for offer #1001',
      meta: 'claude · claude-sonnet-4-6 · ~7–15 min',
    };
    store.appendMessage(root, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Status changed.',
      events: [
        {
          seq: 1,
          type: 'confirm',
          token: parentToken,
          summary: 'Set status',
          meta: 'tracker write',
          kind: 'set-status',
        },
      ],
    });

    expect(store.appendConfirmAfter(root, parentToken, child)).toBe(true);
    expect(store.appendConfirmAfter(root, parentToken, child)).toBe(true);

    const [message] = store.listMessages(root, conversation.id);
    expect(
      (message.events ?? []).filter(
        event => hasType(event, 'confirm') && event.token === child.token,
      ),
    ).toHaveLength(1);
  });

  it('does not rewrite a missing, incidental, or corrupt candidate owner', () => {
    const conversation = store.createConversation(root);
    const incidental = store.appendMessage(root, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Incidental token only.',
      events: [{ seq: 1, type: 'text-delta', text: 'mentions unsafe-parent-token incidentally' }],
    });
    const corrupt = store.appendMessage(root, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Corrupt events.',
      events: [
        {
          seq: 1,
          type: 'confirm',
          token: 'corrupt-parent-token',
          summary: 'Set status',
          meta: 'tracker write',
          kind: 'set-status',
        },
      ],
    });
    const invalidOwner = store.appendMessage(root, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Schema-invalid events.',
      events: [{ type: 'confirm', token: 'invalid-owner-token' }],
    });
    db.openChatDb(root)
      .prepare('UPDATE messages SET events_json = ? WHERE id = ?')
      .run('{"token":"corrupt-parent-token"', corrupt.id);

    const child = { token: 'never-appended', summary: 'Start prep', meta: 'AI spend' };
    expect(store.appendConfirmAfter(root, 'missing-parent-token', child)).toBe(false);
    expect(store.appendConfirmAfter(root, 'unsafe-parent-token', child)).toBe(false);
    expect(store.appendConfirmAfter(root, 'corrupt-parent-token', child)).toBe(false);
    expect(store.appendConfirmAfter(root, 'invalid-owner-token', child)).toBe(false);

    const rows = db
      .openChatDb(root)
      .prepare('SELECT id, events_json FROM messages ORDER BY position')
      .all() as Array<{ id: string; events_json: string }>;
    expect(rows.find(row => row.id === incidental.id)?.events_json).toBe(
      JSON.stringify(incidental.events),
    );
    expect(rows.find(row => row.id === corrupt.id)?.events_json).toBe(
      '{"token":"corrupt-parent-token"',
    );
    expect(rows.find(row => row.id === invalidOwner.id)?.events_json).toBe(
      JSON.stringify(invalidOwner.events),
    );
  });
});
