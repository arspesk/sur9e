import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_STORE_PERSIST_KEY,
  DRAFT_OVERRIDE_KEY,
  MAX_SELECTION_CHARS,
  useChatStore,
} from '@/stores/chat-store';

function reset() {
  useChatStore.setState({
    open: false,
    activeConversationId: null,
    streamingTurnId: null,
    queuedMessages: {},
    queuedAttachments: {},
    lastUserMessages: {},
    setupRequired: false,
    modelOverride: {},
    unreadConversationIds: [],
  });
}

const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'application/pdf' });

describe('chat-store', () => {
  beforeEach(reset);

  it('openChat/closeChat/toggleChat drive the open flag', () => {
    const s = useChatStore.getState();
    s.openChat();
    expect(useChatStore.getState().open).toBe(true);
    useChatStore.getState().toggleChat();
    expect(useChatStore.getState().open).toBe(false);
    useChatStore.getState().toggleChat();
    expect(useChatStore.getState().open).toBe(true);
    useChatStore.getState().closeChat();
    expect(useChatStore.getState().open).toBe(false);
  });

  it('takeQueuedMessage returns the queued text once and clears the slot', () => {
    useChatStore.getState().setQueuedMessage('c1', 'follow up please');
    expect(useChatStore.getState().takeQueuedMessage('c1')).toBe('follow up please');
    expect(useChatStore.getState().queuedMessages).toEqual({});
    expect(useChatStore.getState().takeQueuedMessage('c1')).toBeNull();
  });

  it('takeQueuedAttachments returns the queued files once and clears the slot', () => {
    const f = file('cv.pdf');
    useChatStore.getState().setQueuedAttachments('c1', [f]);
    expect(useChatStore.getState().queuedAttachments.c1).toEqual([f]);
    expect(useChatStore.getState().takeQueuedAttachments('c1')).toEqual([f]);
    expect(useChatStore.getState().queuedAttachments).toEqual({});
    expect(useChatStore.getState().takeQueuedAttachments('c1')).toEqual([]);
  });

  it('setQueuedAttachments with null or an empty array clears the slot', () => {
    const f = file('cv.pdf');
    useChatStore.getState().setQueuedAttachments('c1', [f]);
    useChatStore.getState().setQueuedAttachments('c1', null);
    expect(useChatStore.getState().queuedAttachments).toEqual({});
    useChatStore.getState().setQueuedAttachments('c1', [f]);
    useChatStore.getState().setQueuedAttachments('c1', []);
    expect(useChatStore.getState().queuedAttachments).toEqual({});
  });

  it('setModelOverride sets per-key pairs; null deletes', () => {
    useChatStore.getState().setModelOverride('c1', { provider: 'codex', model: 'gpt-x' });
    expect(useChatStore.getState().modelOverride.c1).toEqual({ provider: 'codex', model: 'gpt-x' });
    useChatStore.getState().setModelOverride('c1', null);
    expect(useChatStore.getState().modelOverride.c1).toBeUndefined();
  });

  it('adoptDraftOverride moves the draft pair onto a real conversation id', () => {
    useChatStore
      .getState()
      .setModelOverride(DRAFT_OVERRIDE_KEY, { provider: 'opencode', model: 'a/b' });
    useChatStore.getState().adoptDraftOverride('c9');
    const map = useChatStore.getState().modelOverride;
    expect(map.c9).toEqual({ provider: 'opencode', model: 'a/b' });
    expect(map[DRAFT_OVERRIDE_KEY]).toBeUndefined();
  });

  it('adoptDraftOverride is a no-op without a draft', () => {
    useChatStore.getState().adoptDraftOverride('c9');
    expect(useChatStore.getState().modelOverride.c9).toBeUndefined();
  });
});

describe('per-conversation message scoping', () => {
  beforeEach(reset);

  it('queued and last-user messages are scoped per conversation', () => {
    const s = useChatStore.getState();
    s.setQueuedMessage('a', 'for a');
    s.setLastUserMessage('b', 'sent in b');
    expect(useChatStore.getState().queuedMessages).toEqual({ a: 'for a' });
    expect(s.takeQueuedMessage('b')).toBeNull();
    expect(s.takeQueuedMessage('a')).toBe('for a');
    expect(useChatStore.getState().queuedMessages).toEqual({});
    expect(useChatStore.getState().lastUserMessages.b).toBe('sent in b');
  });

  it('setQueuedMessage(key, null) clears only that conversation slot', () => {
    const s = useChatStore.getState();
    s.setQueuedMessage('a', 'keep');
    s.setQueuedMessage('b', 'drop');
    s.setQueuedMessage('b', null);
    expect(useChatStore.getState().queuedMessages).toEqual({ a: 'keep' });
  });

  it('adoptDraftOverride moves draft queued/last-user slots onto the created id', () => {
    const s = useChatStore.getState();
    s.setQueuedMessage(DRAFT_OVERRIDE_KEY, 'queued');
    s.setLastUserMessage(DRAFT_OVERRIDE_KEY, 'last');
    s.adoptDraftOverride('c9');
    const st = useChatStore.getState();
    expect(st.queuedMessages).toEqual({ c9: 'queued' });
    expect(st.lastUserMessages).toEqual({ c9: 'last' });
  });

  it('adoptDraftOverride moves the draft queued-attachments slot onto the created id', () => {
    const f = file('cv.pdf');
    const s = useChatStore.getState();
    s.setQueuedAttachments(DRAFT_OVERRIDE_KEY, [f]);
    s.adoptDraftOverride('c9');
    const st = useChatStore.getState();
    expect(st.queuedAttachments).toEqual({ c9: [f] });
    expect(st.queuedAttachments[DRAFT_OVERRIDE_KEY]).toBeUndefined();
  });
});

describe('selections slice (single chip)', () => {
  beforeEach(() => useChatStore.setState({ selections: [] }));

  it('addSelection stages the trimmed text as the one chip', () => {
    useChatStore.getState().addSelection('  a real selection  ');
    expect(useChatStore.getState().selections).toEqual(['a real selection']);
  });

  it('a new selection REPLACES the current one — never stacks', () => {
    const s = useChatStore.getState();
    s.addSelection('first pick');
    s.addSelection('second pick');
    s.addSelection('third pick');
    expect(useChatStore.getState().selections).toEqual(['third pick']);
  });

  it('re-adding the identical current chip is a no-op (same array reference)', () => {
    const s = useChatStore.getState();
    s.addSelection('same text');
    const before = useChatStore.getState().selections;
    s.addSelection('same text');
    expect(useChatStore.getState().selections).toBe(before);
    expect(useChatStore.getState().selections).toEqual(['same text']);
  });

  it('an empty/whitespace-only selection is ignored', () => {
    const s = useChatStore.getState();
    s.addSelection('kept');
    s.addSelection('   ');
    expect(useChatStore.getState().selections).toEqual(['kept']);
  });

  it('caps the entry to MAX_SELECTION_CHARS', () => {
    useChatStore.getState().addSelection('x'.repeat(MAX_SELECTION_CHARS + 500));
    expect(useChatStore.getState().selections[0]).toHaveLength(MAX_SELECTION_CHARS);
  });

  it('removeSelection drops the chip; clearSelections empties', () => {
    const s = useChatStore.getState();
    s.addSelection('one');
    s.removeSelection(0);
    expect(useChatStore.getState().selections).toEqual([]);
    s.addSelection('two');
    s.clearSelections();
    expect(useChatStore.getState().selections).toEqual([]);
  });
});

describe('unread conversations', () => {
  beforeEach(reset);

  it('markUnread dedups; clearUnread removes', () => {
    const s = useChatStore.getState();
    s.markUnread('a');
    s.markUnread('a');
    s.markUnread('b');
    expect(useChatStore.getState().unreadConversationIds).toEqual(['a', 'b']);
    s.clearUnread('a');
    expect(useChatStore.getState().unreadConversationIds).toEqual(['b']);
  });

  it('opening a conversation clears its unread mark', () => {
    const s = useChatStore.getState();
    s.markUnread('a');
    s.setActiveConversation('a');
    expect(useChatStore.getState().unreadConversationIds).toEqual([]);
  });

  it('opening the chat clears the ACTIVE conversation unread mark only', () => {
    const s = useChatStore.getState();
    useChatStore.setState({ activeConversationId: 'a' });
    s.markUnread('a');
    s.markUnread('b');
    s.openChat();
    expect(useChatStore.getState().unreadConversationIds).toEqual(['b']);
  });
});

describe('modelOverride persistence', () => {
  // reset() writes {modelOverride:{}} through persist; clear first so each test
  // starts from an empty localStorage slot.
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  const persistedState = (): Record<string, unknown> | null => {
    const raw = localStorage.getItem(CHAT_STORE_PERSIST_KEY);
    return raw ? (JSON.parse(raw).state as Record<string, unknown>) : null;
  };

  it('persists ONLY the modelOverride slice — session-only state stays out of storage', () => {
    const s = useChatStore.getState();
    // One per-conversation override (persists) alongside a spread of
    // session-only mutations (must NOT persist).
    s.setModelOverride('c1', { provider: 'codex', model: 'gpt-x' });
    s.openChat();
    s.setQueuedMessage('c1', 'draft text');
    s.setLastUserMessage('c1', 'last sent');
    s.markUnread('c1');
    s.setSetupRequired(true);
    s.addSelection('a page selection');

    const persisted = persistedState();
    expect(persisted).toEqual({ modelOverride: { c1: { provider: 'codex', model: 'gpt-x' } } });
    // Belt-and-suspenders: none of the session-only keys leaked into storage.
    for (const key of [
      'open',
      'activeConversationId',
      'streamingTurnId',
      'queuedMessages',
      'queuedAttachments',
      'selections',
      'lastUserMessages',
      'setupRequired',
      'minimizedByDrawer',
      'unreadConversationIds',
    ]) {
      expect(persisted).not.toHaveProperty(key);
    }
  });

  it('a store-written override round-trips back through rehydrate', async () => {
    // 1. Selecting a model persists it (the exact blob persist wrote).
    useChatStore.getState().setModelOverride('c1', { provider: 'codex', model: 'gpt-x' });
    const blob = localStorage.getItem(CHAT_STORE_PERSIST_KEY);
    expect(blob).not.toBeNull();

    // 2. Simulate a reload: in-memory overrides gone, storage still holds the
    //    persisted blob (re-seed it since the setState above would have written
    //    over it — here we set it back to what persist actually produced).
    useChatStore.setState({ modelOverride: {}, open: true, unreadConversationIds: ['c1'] });
    localStorage.setItem(CHAT_STORE_PERSIST_KEY, blob as string);
    expect(useChatStore.getState().modelOverride).toEqual({});

    // 3. rehydrate() pulls the override back in.
    await useChatStore.persist.rehydrate();
    expect(useChatStore.getState().modelOverride).toEqual({
      c1: { provider: 'codex', model: 'gpt-x' },
    });
    // Session-only slices are NOT restored by rehydrate (never persisted) —
    // they keep their current (post-"reload") in-memory values.
    expect(useChatStore.getState().open).toBe(true);
    expect(useChatStore.getState().unreadConversationIds).toEqual(['c1']);
  });

  it('rehydrate() loads a prior sessions overrides; skipHydration keeps them out of the initial state', async () => {
    // Storage as a previous session left it.
    localStorage.setItem(
      CHAT_STORE_PERSIST_KEY,
      JSON.stringify({
        version: 1,
        state: { modelOverride: { c1: { provider: 'opencode', model: 'a/b' } } },
      }),
    );
    // skipHydration:true → the live store has not read storage yet.
    expect(useChatStore.getState().modelOverride).toEqual({});

    await useChatStore.persist.rehydrate();
    expect(useChatStore.getState().modelOverride).toEqual({
      c1: { provider: 'opencode', model: 'a/b' },
    });
  });

  it('adoptDraftOverride re-keys the draft onto the real id AND persists it there', () => {
    const s = useChatStore.getState();
    s.setModelOverride(DRAFT_OVERRIDE_KEY, { provider: 'opencode', model: 'a/b' });
    s.adoptDraftOverride('c9');

    const persisted = persistedState();
    expect(persisted?.modelOverride).toEqual({ c9: { provider: 'opencode', model: 'a/b' } });
  });
});
