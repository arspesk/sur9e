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

describe('confirm resolution persists to the owning message', () => {
  let root: string;
  let confirms: ConfirmsModule;
  let store: StoreModule;

  beforeEach(async () => {
    root = seedRoot();
    vi.resetModules();
    confirms = await import('@/lib/server/chat/confirms');
    store = await import('@/lib/server/chat/store');
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

  it('approve: the started outcome lands in events_json and re-renders as job-started, no buttons', () => {
    const { conversationId, token } = seedTurn();

    const res = confirms.resolveConfirm(root, token, true);
    expect(res.outcome).toBe('approved');

    // Reload from disk — the persisted events now carry the confirm-resolved.
    const [msg] = store.listMessages(root, conversationId);
    expect(
      (msg.events ?? []).some(e => hasType(e, 'confirm-resolved') && e.outcome === 'approved'),
    ).toBe(true);

    // foldEvents over the reloaded, re-validated events yields a resolved card.
    const confirm = foldEvents(reloadEvents(msg.events)).find(i => i.kind === 'confirm');
    expect(confirm).toMatchObject({ kind: 'confirm', outcome: 'approved', action: 'start-job' });
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
    expect(getByText('✓ Started — running in the jobs strip')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('cancel: the cancelled outcome persists and re-renders as cancelled, no buttons', () => {
    const { conversationId, token } = seedTurn();

    const res = confirms.resolveConfirm(root, token, false);
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

  it('is idempotent: a stale second resolve never overwrites the recorded outcome', () => {
    const { conversationId, token } = seedTurn();

    confirms.resolveConfirm(root, token, true); // approved persisted
    // A late/stale click: the token is already consumed, so it resolves to
    // expired — which must NOT clobber the approved state on the message.
    const second = confirms.resolveConfirm(root, token, false);
    expect(second.outcome).toBe('expired');

    const [msg] = store.listMessages(root, conversationId);
    const resolutions = (msg.events ?? []).filter(e => hasType(e, 'confirm-resolved'));
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].outcome).toBe('approved');
  });

  it('a resolve whose owning message is not (yet) persisted is a harmless no-op', () => {
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

    const res = confirms.resolveConfirm(root, token, true);
    expect(res.outcome).toBe('approved');
    // No assistant message existed, so listMessages is empty and nothing threw.
    expect(store.listMessages(root, conversation.id)).toHaveLength(0);
  });
});
