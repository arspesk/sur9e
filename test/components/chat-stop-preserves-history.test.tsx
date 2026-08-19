// test/components/chat-stop-preserves-history.test.tsx
//
// Issue #106: pressing Stop must not wipe the transcript. The designed flow:
// handleStop stays ATTACHED to the SSE stream (the server emits the terminal
// 'cancelled' event synchronously and persists the partial before answering
// the cancel POST), then invalidates the session query so the persisted
// partial replaces the live view — rendered exactly once, never zero times.
// FakeEventSource + a route-keyed fetch double, same doubles as
// chat-card.test.tsx.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatCard } from '@/features/chat/chat-card';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Stateful double: after the cancel POST resolves, the session GET starts
 * returning the server-persisted rows (user + partial assistant) — exactly
 * what the real cancel path guarantees, since cancelTurn persists the
 * partial synchronously before the POST handler returns. */
function stubFetch(opts: {
  cancel: { promise: Promise<Response> };
  persistedAfterCancel: Array<{ id: string; role: string; content: string }>;
}) {
  let cancelled = false;
  const sessionGets: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/providers') return okResponse({ providers: {} });
    if (url === '/api/settings') return okResponse({});
    if (url === '/api/applications') return okResponse({ entries: [], count: 0 });
    if (url === '/api/chat/sessions' && method === 'POST') {
      return okResponse({ session: fakeSession('c1') }, 201);
    }
    if (/^\/api\/chat\/sessions\/[^/]+$/.test(url) && method === 'GET') {
      sessionGets.push(url);
      const id = url.split('/').pop() as string;
      return okResponse({
        session: fakeSession(id),
        messages: cancelled ? opts.persistedAfterCancel : [],
      });
    }
    if (/^\/api\/chat\/turns\/[^/]+$/.test(url) && method === 'GET') {
      return okResponse({ status: 'running', conversationId: 'c1' });
    }
    if (/\/turns$/.test(url) && method === 'POST') {
      return okResponse({ turnId: 't1', userMessageId: 'u1' }, 202);
    }
    if (/\/cancel$/.test(url) && method === 'POST') {
      return opts.cancel.promise.then(res => {
        cancelled = true;
        return res;
      });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, sessionGets };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ChatCard />, { wrapper });
}

function typeAndEnter(text: string) {
  const box = screen.getByLabelText('Message') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
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

describe('Stop preserves history (#106)', () => {
  it('stays attached through cancel, then swaps to the persisted partial exactly once', async () => {
    const cancel = deferred<Response>();
    const { fetchMock, sessionGets } = stubFetch({
      cancel,
      persistedAfterCancel: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'partial answer' },
      ],
    });
    renderCard();
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeTruthy());
    typeAndEnter('hello');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0];
    es.emit({ seq: 1, type: 'text-delta', text: 'partial answer' });
    await screen.findByText('partial answer');

    fireEvent.click(screen.getByLabelText('Stop reply'));

    // The cancel POST went out…
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          c => String(c[0]) === '/api/chat/turns/t1/cancel' && c[1]?.method === 'POST',
        ),
      ).toBe(true),
    );
    // …and the stream is still attached: the terminal event must arrive
    // through it, not be cut off by an eager detach (the old bug).
    expect(es.closed).toBe(false);
    // The server emits the terminal 'cancelled' error synchronously.
    es.emit({ seq: 2, type: 'error', message: 'cancelled' });
    // The partial never disappears while the cancel settles.
    expect(screen.getByText('partial answer')).toBeTruthy();

    const sessionGetsBefore = sessionGets.length;
    act(() => cancel.resolve(okResponse({ cancelled: true })));

    // The session query refetches (the persisted rows are guaranteed to
    // exist by now) and the partial renders exactly once — the live copy
    // retired, the persisted copy in its place.
    await waitFor(() => expect(sessionGets.length).toBeGreaterThan(sessionGetsBefore));
    await waitFor(() => expect(screen.getAllByText('partial answer')).toHaveLength(1));
    expect(screen.getAllByText('hello')).toHaveLength(1);
  });

  it('falls back to detaching when the cancel POST fails', async () => {
    const cancel = deferred<Response>();
    stubFetch({ cancel, persistedAfterCancel: [] });
    renderCard();
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeTruthy());
    typeAndEnter('hello');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].emit({ seq: 1, type: 'text-delta', text: 'partial answer' });
    await screen.findByText('partial answer');

    fireEvent.click(screen.getByLabelText('Stop reply'));
    await act(async () => {
      cancel.resolve(Promise.reject(new Error('network down')) as never);
      await Promise.resolve();
    });

    // Streaming UI ends (composer back to send mode) and the streamed text
    // is still on screen — degraded, but never a wipe.
    await waitFor(() => expect(screen.queryByLabelText('Stop reply')).toBeNull());
    expect(screen.getByText('partial answer')).toBeTruthy();
  });
});
