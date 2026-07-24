import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backgroundTurnTick } from '@/features/chat/use-background-turn-watcher';
import {
  clearActiveTurn,
  persistActiveTurn,
  readPersistedActiveTurns,
} from '@/hooks/use-chat-turn';
import { useChatStore } from '@/stores/chat-store';

function okResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

function stubStatus(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okResponse(body, ok ? 200 : 404)),
  );
}

/** Route-keyed stub: GET /api/chat/turns/<id> → per-turn status; POST
 * …/turns → the queued-flush turn creation. */
function stubRoutes(opts: {
  statusByTurn: Record<string, string>;
  turnPost?: { body: unknown; status?: number };
  onFetch?: (url: string) => void;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      opts.onFetch?.(url);
      if (/\/turns$/.test(url) && init?.method === 'POST') {
        return okResponse(opts.turnPost?.body ?? {}, opts.turnPost?.status ?? 202);
      }
      const id = url.split('/').pop() as string;
      const status = opts.statusByTurn[id];
      return status ? okResponse({ status }) : okResponse({ error: 'Turn not found' }, 404);
    }),
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  useChatStore.setState({
    open: false,
    activeConversationId: null,
    unreadConversationIds: [],
    queuedMessages: {},
    queuedAttachments: {},
    selections: [],
    modelOverride: {},
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('backgroundTurnTick', () => {
  it('a finished background turn marks its conversation unread and drops the record', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    useChatStore.setState({ open: true, activeConversationId: 'conv-b' });
    stubStatus({ status: 'done', conversationId: 'conv-a' });
    await backgroundTurnTick(new QueryClient());
    expect(useChatStore.getState().unreadConversationIds).toContain('conv-a');
    expect(readPersistedActiveTurns()).toEqual([]);
  });

  it('skips while the open card owns the stream', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    useChatStore.setState({ open: true, activeConversationId: 'conv-a' });
    stubStatus({ status: 'done', conversationId: 'conv-a' });
    await backgroundTurnTick(new QueryClient());
    expect(readPersistedActiveTurns()).toHaveLength(1);
    expect(useChatStore.getState().unreadConversationIds).toEqual([]);
  });

  it('a still-running turn keeps the record and marks nothing', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    stubStatus({ status: 'running', conversationId: 'conv-a' });
    await backgroundTurnTick(new QueryClient());
    expect(readPersistedActiveTurns()).toHaveLength(1);
    expect(useChatStore.getState().unreadConversationIds).toEqual([]);
  });

  it('404 (server restarted) drops the record without an unread mark', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    stubStatus({ error: 'Turn not found' }, false);
    await backgroundTurnTick(new QueryClient());
    expect(readPersistedActiveTurns()).toEqual([]);
    expect(useChatStore.getState().unreadConversationIds).toEqual([]);
  });

  it('watches EVERY persisted turn — a second thread finishing is not orphaned', async () => {
    persistActiveTurn({ turnId: 't1', conversationId: 'conv-a' });
    persistActiveTurn({ turnId: 't2', conversationId: 'conv-b' });
    stubRoutes({ statusByTurn: { t1: 'done', t2: 'running' } });
    await backgroundTurnTick(new QueryClient());
    expect(useChatStore.getState().unreadConversationIds).toEqual(['conv-a']);
    expect(readPersistedActiveTurns()).toEqual([{ turnId: 't2', conversationId: 'conv-b' }]);
  });

  it('probes another thread turn even while the card owns its own stream', async () => {
    persistActiveTurn({ turnId: 't1', conversationId: 'conv-a' });
    persistActiveTurn({ turnId: 't2', conversationId: 'conv-b' });
    useChatStore.setState({ open: true, activeConversationId: 'conv-b' });
    const urls: string[] = [];
    stubRoutes({ statusByTurn: { t1: 'done', t2: 'running' }, onFetch: u => urls.push(u) });
    await backgroundTurnTick(new QueryClient());
    expect(useChatStore.getState().unreadConversationIds).toEqual(['conv-a']);
    // conv-b's turn is the card's — never probed by the watcher.
    expect(urls).toEqual(['/api/chat/turns/t1']);
    expect(readPersistedActiveTurns()).toEqual([{ turnId: 't2', conversationId: 'conv-b' }]);
  });

  it('no unread dot when the attached stream cleared the record mid-probe', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // The card's SSE 'done' lands while the probe is in flight — the
        // hook clears the record; the user already watched the reply.
        clearActiveTurn('t9');
        return okResponse({ status: 'done' });
      }),
    );
    await backgroundTurnTick(new QueryClient());
    expect(useChatStore.getState().unreadConversationIds).toEqual([]);
  });

  it('no unread dot when the user re-entered the thread mid-probe', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        useChatStore.setState({ open: true, activeConversationId: 'conv-a' });
        return okResponse({ status: 'done' });
      }),
    );
    await backgroundTurnTick(new QueryClient());
    expect(useChatStore.getState().unreadConversationIds).toEqual([]);
    // The record stays — the card's own return probe owns the cleanup now.
    expect(readPersistedActiveTurns()).toHaveLength(1);
  });

  it('a queued message flushes as a new turn when its turn finished (chat open)', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    // Open on a DIFFERENT thread — the user is still in chat, so the queued
    // follow-up auto-sends.
    useChatStore.setState({ open: true, activeConversationId: 'conv-b' });
    useChatStore.getState().setQueuedMessage('conv-a', 'follow-up question');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/\/turns$/.test(url) && init?.method === 'POST') {
        return okResponse({ turnId: 't10' }, 202);
      }
      return okResponse({ status: 'done' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await backgroundTurnTick(new QueryClient());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(String(post?.[0])).toBe('/api/chat/sessions/conv-a/turns');
    expect(JSON.parse(String(post?.[1]?.body)).message).toBe('follow-up question');
    // The flushed turn joins the list so IT gets watcher coverage too.
    expect(readPersistedActiveTurns()).toEqual([{ turnId: 't10', conversationId: 'conv-a' }]);
    expect(useChatStore.getState().queuedMessages).toEqual({});
    expect(useChatStore.getState().unreadConversationIds).toEqual(['conv-a']);
  });

  it('flushes queued attachments too — uploads then posts the turn with metadata', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    useChatStore.setState({ open: true, activeConversationId: 'conv-b' });
    useChatStore.getState().setQueuedMessage('conv-a', 'read this');
    const f = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    useChatStore.getState().setQueuedAttachments('conv-a', [f]);
    const attachment = { path: 'conv-a/f1.pdf', name: 'cv.pdf', mime: 'application/pdf', size: 1 };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/chat/uploads' && init?.method === 'POST') {
        return okResponse({ attachments: [attachment] }, 201);
      }
      if (/\/turns$/.test(url) && init?.method === 'POST')
        return okResponse({ turnId: 't10' }, 202);
      return okResponse({ status: 'done' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await backgroundTurnTick(new QueryClient());
    const uploadCall = fetchMock.mock.calls.find(([u]) => String(u) === '/api/chat/uploads');
    expect(uploadCall).toBeTruthy();
    const post = fetchMock.mock.calls.find(
      ([u, init]) => /\/turns$/.test(String(u)) && init?.method === 'POST',
    );
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.message).toBe('read this');
    expect(body.attachments).toEqual([attachment]);
    expect(useChatStore.getState().queuedMessages).toEqual({});
    expect(useChatStore.getState().queuedAttachments).toEqual({});
  });

  it('a flushed queued turn carries the staged on-screen selections, then clears them', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    useChatStore.setState({ open: true, activeConversationId: 'conv-b' });
    useChatStore.getState().setQueuedMessage('conv-a', 'follow-up');
    useChatStore.getState().addSelection('a bit of text the user highlighted');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/\/turns$/.test(url) && init?.method === 'POST') {
        return okResponse({ turnId: 't10' }, 202);
      }
      return okResponse({ status: 'done' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await backgroundTurnTick(new QueryClient());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.selections).toEqual(['a bit of text the user highlighted']);
    // A successful flush clears the shared selection draft.
    expect(useChatStore.getState().selections).toEqual([]);
  });

  it('a failed queued flush puts BOTH the message and files back', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    useChatStore.setState({ open: true, activeConversationId: 'conv-b' });
    useChatStore.getState().setQueuedMessage('conv-a', 'read this');
    const f = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    useChatStore.getState().setQueuedAttachments('conv-a', [f]);
    // Upload succeeds, the turn POST fails → both slots must be restored.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/chat/uploads' && init?.method === 'POST') {
        return okResponse({ attachments: [] }, 201);
      }
      if (/\/turns$/.test(url) && init?.method === 'POST')
        return okResponse({ error: 'boom' }, 500);
      return okResponse({ status: 'done' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await backgroundTurnTick(new QueryClient());
    expect(useChatStore.getState().queuedMessages).toEqual({ 'conv-a': 'read this' });
    expect(useChatStore.getState().queuedAttachments).toEqual({ 'conv-a': [f] });
  });

  it('HOLDS the queued message (no send) when the chat is CLOSED', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    // Chat closed (beforeEach default open:false) — unattended send would spend
    // tokens nobody is watching, so the queue is held for the composer to
    // restore on reopen.
    useChatStore.getState().setQueuedMessage('conv-a', 'follow-up question');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/\/turns$/.test(url) && init?.method === 'POST')
        return okResponse({ turnId: 't10' }, 202);
      return okResponse({ status: 'done' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await backgroundTurnTick(new QueryClient());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(useChatStore.getState().queuedMessages).toEqual({ 'conv-a': 'follow-up question' });
    // The record still clears + the conversation is still marked unread.
    expect(readPersistedActiveTurns()).toEqual([]);
    expect(useChatStore.getState().unreadConversationIds).toEqual(['conv-a']);
  });

  it('a failed queued flush puts the message back instead of losing it', async () => {
    persistActiveTurn({ turnId: 't9', conversationId: 'conv-a' });
    useChatStore.setState({ open: true, activeConversationId: 'conv-b' });
    useChatStore.getState().setQueuedMessage('conv-a', 'follow-up question');
    stubRoutes({
      statusByTurn: { t9: 'done' },
      turnPost: { body: { error: 'boom' }, status: 500 },
    });
    await backgroundTurnTick(new QueryClient());
    expect(useChatStore.getState().queuedMessages).toEqual({ 'conv-a': 'follow-up question' });
    expect(readPersistedActiveTurns()).toEqual([]);
  });
});
