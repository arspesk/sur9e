// test/components/chat-card.test.tsx
//
// ChatCard integration: composer → send → SSE stream → transcript, queue-
// while-streaming auto-send, sessionStorage reattach on mount, and the
// setupRequired edge card. FakeEventSource + a route-keyed fetch double
// stand in for the real transport (same doubles as use-chat-turn.test.tsx /
// chat-header.test.tsx).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatCard } from '@/features/chat/chat-card';
import { persistActiveTurn } from '@/hooks/use-chat-turn';
import { useChatStore } from '@/stores/chat-store';

const pushSpy = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, refresh: () => {}, replace: () => {} }),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(event: object) {
    act(() => this.onmessage?.({ data: JSON.stringify(event) }));
  }
}

function fakeSession(id: string) {
  return { id, title: 'New chat', mode: null, archived: false, createdAt: '', updatedAt: '' };
}

function okResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

/** Route-keyed fetch double covering everything ChatCard (+ the ChatHeader
 * it renders) touches. `turnResponses` lets a test queue a different body
 * per POST .../turns call — e.g. a turnId then a later setupRequired.
 * `turnStatus` is what GET /api/chat/turns/[id] (the reattach probe)
 * reports for any turn. */
function stubFetch(
  turnResponses: Array<{ turnId: string } | { setupRequired: true }> = [{ turnId: 't1' }],
  turnStatus = 'running',
) {
  let turnCall = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/providers') return okResponse({ providers: {} });
      if (url === '/api/settings') return okResponse({});
      // The composer's @-mention popover mounts useApplications.
      if (url === '/api/applications') return okResponse({ entries: [], count: 0 });
      if (url === '/api/chat/sessions' && method === 'POST') {
        return okResponse({ session: fakeSession('c1') }, 201);
      }
      if (/^\/api\/chat\/sessions\/[^/]+$/.test(url) && method === 'GET') {
        const id = url.split('/').pop() as string;
        return okResponse({ session: fakeSession(id), messages: [] });
      }
      if (/^\/api\/chat\/turns\/[^/]+$/.test(url) && method === 'GET') {
        return okResponse({ status: turnStatus, conversationId: 'c1' });
      }
      if (/\/turns$/.test(url) && method === 'POST') {
        const body = turnResponses[Math.min(turnCall, turnResponses.length - 1)];
        turnCall += 1;
        return okResponse(body, 'setupRequired' in body ? 200 : 202);
      }
      if (url === '/api/chat/uploads' && method === 'POST') {
        return okResponse(
          {
            attachments: [{ path: 'c1/f1.pdf', name: 'cv.pdf', mime: 'application/pdf', size: 1 }],
          },
          201,
        );
      }
      if (/\/cancel$/.test(url) && method === 'POST') return okResponse({ cancelled: true });
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }),
  );
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ChatCard />, { wrapper });
}

function textarea() {
  return screen.getByLabelText('Message') as HTMLTextAreaElement;
}

/** Types + presses Enter — works whether the composer is idle (sends) or
 * streaming (queues), mirroring real keyboard use. */
function typeAndEnter(text: string) {
  fireEvent.change(textarea(), { target: { value: text } });
  fireEvent.keyDown(textarea(), { key: 'Enter' });
}

function liveRegion() {
  return document.querySelector('[aria-live="polite"]');
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  window.sessionStorage.clear();
  pushSpy.mockClear();
  useChatStore.setState({
    open: true,
    activeConversationId: null,
    streamingTurnId: null,
    queuedMessages: {},
    queuedAttachments: {},
    lastUserMessages: {},
    setupRequired: false,
    modelOverride: {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatCard', () => {
  it('renders an aria-live status region, empty while idle', () => {
    stubFetch();
    renderCard();
    expect(liveRegion()).toBeTruthy();
    expect(liveRegion()?.textContent).toBe('');
  });

  it('send creates a session, opens the turn stream, and folds deltas into the transcript', async () => {
    stubFetch();
    renderCard();
    typeAndEnter('Hi there');

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0].url).toBe('/api/chat/turns/t1/events?after=0');
    expect(liveRegion()?.textContent).toBe('AI is replying');

    FakeEventSource.instances[0].emit({ seq: 1, type: 'text-delta', text: 'Hello' });
    await waitFor(() => expect(document.querySelector('.chat-md')?.textContent).toContain('Hello'));

    FakeEventSource.instances[0].emit({ seq: 2, type: 'done', messageId: 'm1' });
    await waitFor(() => expect(liveRegion()?.textContent).toBe('Reply finished'));
    expect(useChatStore.getState().streamingTurnId).toBeNull();
  });

  it('a ui:navigate event during the stream calls router.push', async () => {
    stubFetch();
    renderCard();
    typeAndEnter('go to offers');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.instances[0].emit({ seq: 1, type: 'ui', action: 'navigate', path: '/offers' });
    expect(pushSpy).toHaveBeenCalledWith('/offers');
  });

  it('a message typed while streaming is queued, then auto-sent once the reply is done', async () => {
    stubFetch([{ turnId: 't1' }, { turnId: 't2' }]);
    renderCard();
    typeAndEnter('first');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    typeAndEnter('second');
    expect(screen.getByText('Queued — sends when the reply finishes')).toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(1); // no second stream opened yet

    FakeEventSource.instances[0].emit({ seq: 1, type: 'done', messageId: 'm1' });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1].url).toBe('/api/chat/turns/t2/events?after=0');
    expect(useChatStore.getState().queuedMessages).toEqual({});
  });

  it('reattaches a persisted in-flight turn on mount with a full replay', async () => {
    stubFetch();
    persistActiveTurn({ turnId: 't9', conversationId: 'c9' });
    renderCard();

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0].url).toBe('/api/chat/turns/t9/events?after=0');
    expect(useChatStore.getState().activeConversationId).toBe('c9');
    expect(useChatStore.getState().streamingTurnId).toBe('t9');
  });

  it('setupRequired renders the setup card instead of starting a stream', async () => {
    stubFetch([{ setupRequired: true }]);
    renderCard();
    typeAndEnter('hello');

    expect(await screen.findByText('Almost there')).toBeInTheDocument();
    expect(screen.getByText('npm run setup')).toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(useChatStore.getState().setupRequired).toBe(true);
  });

  it('switching conversations clears the live turn WITHOUT cancelling it', async () => {
    stubFetch();
    renderCard();
    typeAndEnter('hello from A');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0];
    es.emit({ seq: 1, type: 'text-delta', text: 'streaming into A' });
    await screen.findByText('streaming into A');
    act(() => useChatStore.getState().setActiveConversation('b2'));
    await waitFor(() => expect(screen.queryByText('streaming into A')).toBeNull());
    expect(screen.queryByText('hello from A')).toBeNull();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/cancel'))).toBe(false);
  });

  it('returning to a conversation with a live background turn reattaches with full replay', async () => {
    stubFetch();
    renderCard();
    typeAndEnter('hello');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    // Switch away mid-stream (detach, keep the persisted record)…
    act(() => useChatStore.getState().setActiveConversation('b2'));
    expect(FakeEventSource.instances[0].closed).toBe(true);
    // …and back: the status probe says running → new stream with after=0.
    act(() => useChatStore.getState().setActiveConversation('c1'));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1].url).toBe('/api/chat/turns/t1/events?after=0');
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/cancel'))).toBe(false);
  });

  it('a turn that finished while detached drops the record and refetches instead', async () => {
    stubFetch([{ turnId: 't1' }], 'done');
    renderCard();
    typeAndEnter('hello');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => useChatStore.getState().setActiveConversation('b2'));
    act(() => useChatStore.getState().setActiveConversation('c1'));
    await waitFor(() => expect(window.sessionStorage.getItem('sur9e.chat.active-turn')).toBeNull());
    expect(FakeEventSource.instances).toHaveLength(1); // no reattach
  });

  it('reattach fires at most once — streaming renders neither re-probe nor reopen the stream', async () => {
    stubFetch();
    renderCard();
    typeAndEnter('hello');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => useChatStore.getState().setActiveConversation('b2'));
    act(() => useChatStore.getState().setActiveConversation('c1'));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    // The reattach effect re-runs on EVERY render (its `turn` dep is a fresh
    // object each time). Force renders by streaming deltas: a self-looping
    // effect would re-probe and close/reopen the EventSource each pass.
    FakeEventSource.instances[1].emit({ seq: 1, type: 'text-delta', text: 'still going' });
    FakeEventSource.instances[1].emit({ seq: 2, type: 'text-delta', text: ' and going' });
    await waitFor(() =>
      expect(document.querySelector('.chat-md')?.textContent).toContain('still going'),
    );
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const statusProbes = fetchMock.mock.calls.filter(
      ([u, init]) =>
        /^\/api\/chat\/turns\/[^/]+$/.test(String(u)) &&
        ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET',
    );
    expect(statusProbes).toHaveLength(1); // one probe for the whole return trip
    expect(FakeEventSource.instances).toHaveLength(2); // no close/reopen storm
    expect(FakeEventSource.instances[1].closed).toBe(false);
  });

  it('a send in a second thread keeps the first thread persisted turn (list, not slot)', async () => {
    stubFetch([{ turnId: 't1' }, { turnId: 't2' }]);
    renderCard();
    typeAndEnter('hello A');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => useChatStore.getState().setActiveConversation('b2'));
    typeAndEnter('hello B');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    // Thread A's still-running turn must keep its record — the background
    // watcher and a later return-to-A reattach both depend on it.
    const raw = window.sessionStorage.getItem('sur9e.chat.active-turn') ?? '[]';
    expect(JSON.parse(raw)).toEqual([
      { turnId: 't1', conversationId: 'c1' },
      { turnId: 't2', conversationId: 'b2' },
    ]);
  });

  it('a message queued while streaming is restored to the composer (not auto-sent) on return', async () => {
    stubFetch([{ turnId: 't1' }, { turnId: 't2' }], 'done');
    renderCard();
    typeAndEnter('first');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    typeAndEnter('second'); // queued while streaming
    act(() => useChatStore.getState().setActiveConversation('b2'));
    act(() => useChatStore.getState().setActiveConversation('c1'));
    // Returning to an idle thread restores the held follow-up into the input
    // for an explicit send — it never auto-fires a turn.
    await waitFor(() => expect(textarea().value).toBe('second'));
    expect(useChatStore.getState().queuedMessages).toEqual({});
    expect(FakeEventSource.instances).toHaveLength(1); // no second turn started
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const turnPosts = fetchMock.mock.calls.filter(
      ([u, init]) =>
        /\/turns$/.test(String(u)) && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(turnPosts).toHaveLength(1); // only 'first' was sent
  });

  it('switching threads clears draft attachments — no cross-thread upload', async () => {
    stubFetch();
    renderCard();
    const card = document.querySelector('.chat-card') as HTMLElement;
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.drop(card, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(screen.getByText('cv.pdf')).toBeInTheDocument();
    act(() => useChatStore.getState().setActiveConversation('b2'));
    await waitFor(() => expect(screen.queryByText('cv.pdf')).toBeNull());
  });

  it('dropping a file on the card adds a draft chip', () => {
    stubFetch();
    renderCard();
    const card = document.querySelector('.chat-card') as HTMLElement;
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.drop(card, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(screen.getByText('cv.pdf')).toBeInTheDocument();
  });

  it('accepts drops while a reply streams — the file becomes a draft chip', async () => {
    stubFetch();
    renderCard();
    typeAndEnter('hello');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const card = document.querySelector('.chat-card') as HTMLElement;
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.drop(card, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(screen.getByText('cv.pdf')).toBeInTheDocument();
  });

  it('a file attached while streaming is queued, then uploaded + sent on the flush', async () => {
    stubFetch([{ turnId: 't1' }, { turnId: 't2' }]);
    renderCard();
    typeAndEnter('first');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    // Drop a file mid-stream, then Enter → text + file both queue.
    const card = document.querySelector('.chat-card') as HTMLElement;
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.drop(card, { dataTransfer: { files: [file], types: ['Files'] } });
    typeAndEnter('read this next');
    expect(screen.getByText('Queued — sends when the reply finishes')).toBeInTheDocument();
    expect(useChatStore.getState().queuedAttachments.c1).toEqual([file]);
    expect(FakeEventSource.instances).toHaveLength(1); // no second stream yet

    // Finish the first reply → the queue flushes: upload, then a t2 turn that
    // carries the uploaded attachment metadata.
    FakeEventSource.instances[0].emit({ seq: 1, type: 'done', messageId: 'm1' });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1].url).toBe('/api/chat/turns/t2/events?after=0');

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const calls = fetchMock.mock.calls.map(
      ([u, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(u)}`,
    );
    expect(calls).toContain('POST /api/chat/uploads');
    const turnPosts = fetchMock.mock.calls.filter(
      ([u, init]) =>
        /\/turns$/.test(String(u)) && (init as RequestInit | undefined)?.method === 'POST',
    );
    const flushBody = JSON.parse(String((turnPosts[1][1] as RequestInit).body));
    expect(flushBody.message).toBe('read this next');
    expect(flushBody.attachments).toEqual([
      { path: 'c1/f1.pdf', name: 'cv.pdf', mime: 'application/pdf', size: 1 },
    ]);
    expect(useChatStore.getState().queuedAttachments).toEqual({});
    expect(useChatStore.getState().queuedMessages).toEqual({});
  });

  it('send with attachments creates the session FIRST, uploads, then posts the turn with metadata', async () => {
    stubFetch();
    renderCard();
    const card = document.querySelector('.chat-card') as HTMLElement;
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.drop(card, { dataTransfer: { files: [file], types: ['Files'] } });
    typeAndEnter('read this');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const calls = fetchMock.mock.calls.map(
      ([u, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(u)}`,
    );
    const iCreate = calls.indexOf('POST /api/chat/sessions');
    const iUpload = calls.indexOf('POST /api/chat/uploads');
    const iTurn = calls.findIndex(c => /^POST .*\/turns$/.test(c));
    expect(iCreate).toBeGreaterThan(-1);
    expect(iUpload).toBeGreaterThan(iCreate); // conversation exists before the upload
    expect(iTurn).toBeGreaterThan(iUpload); // turn carries the uploaded metadata

    const turnInit = fetchMock.mock.calls[iTurn][1] as RequestInit;
    expect(JSON.parse(String(turnInit.body)).attachments).toEqual([
      { path: 'c1/f1.pdf', name: 'cv.pdf', mime: 'application/pdf', size: 1 },
    ]);
    // Draft chips are cleared once the turn starts.
    expect(screen.queryByText('cv.pdf')).toBeNull();
  });
});
