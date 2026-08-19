// test/components/chat-send-now.test.tsx
//
// Issue #105: the queued-message row gains a "Send now" action — stop the
// in-flight reply (the cancel POST only returns once the conversation lock
// is free, see cancelTurnAndWait), then dispatch the queued text + files
// immediately. On a failed dispatch the taken content is restored to the
// queue slots, which the composer's existing restore effect turns back into
// an editable draft — queued content is never lost. Same FakeEventSource +
// route-keyed fetch doubles as chat-card.test.tsx.

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

/** turnResponses: one entry per POST .../turns call — a turnId, or
 * { fail: true } to answer 500 (chatFetch throws → send() reports failure). */
function stubFetch(turnResponses: Array<{ turnId: string } | { fail: true }>) {
  let turnCall = 0;
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
      const id = url.split('/').pop() as string;
      return okResponse({ session: fakeSession(id), messages: [] });
    }
    if (/^\/api\/chat\/turns\/[^/]+$/.test(url) && method === 'GET') {
      return okResponse({ status: 'running', conversationId: 'c1' });
    }
    if (/\/turns$/.test(url) && method === 'POST') {
      const body = turnResponses[Math.min(turnCall, turnResponses.length - 1)];
      turnCall += 1;
      if ('fail' in body) return okResponse({ error: 'boom' }, 500);
      return okResponse({ turnId: body.turnId, userMessageId: `u-${body.turnId}` }, 202);
    }
    if (/\/cancel$/.test(url) && method === 'POST') return okResponse({ cancelled: true });
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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

function typeAndEnter(text: string) {
  fireEvent.change(textarea(), { target: { value: text } });
  fireEvent.keyDown(textarea(), { key: 'Enter' });
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

async function streamFirstTurnAndQueue() {
  renderCard();
  await waitFor(() => expect(screen.getByLabelText('Message')).toBeTruthy());
  typeAndEnter('first message');
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  FakeEventSource.instances[0].emit({ seq: 1, type: 'text-delta', text: 'streaming reply' });
  typeAndEnter('queued text');
  await screen.findByText('Queued — sends when the reply finishes');
}

describe('Send now on queued messages (#105)', () => {
  it('stops the current reply and dispatches the queued text immediately', async () => {
    const fetchMock = stubFetch([{ turnId: 't1' }, { turnId: 't2' }]);
    await streamFirstTurnAndQueue();

    fireEvent.click(screen.getByLabelText('Send now'));

    // The in-flight reply is cancelled…
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          c => String(c[0]) === '/api/chat/turns/t1/cancel' && c[1]?.method === 'POST',
        ),
      ).toBe(true),
    );
    // …then the queued text goes out as its own turn…
    await waitFor(() => {
      const turnPosts = fetchMock.mock.calls.filter(
        c => /\/turns$/.test(String(c[0])) && c[1]?.method === 'POST',
      );
      expect(turnPosts).toHaveLength(2);
      expect(JSON.parse(String(turnPosts[1][1]?.body)).message).toBe('queued text');
    });
    // …the queue row is gone, and the new turn's stream is attached.
    expect(screen.queryByText('Queued — sends when the reply finishes')).toBeNull();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1].url).toBe('/api/chat/turns/t2/events?after=0');
  });

  it('restores the queued text as an editable draft when the dispatch fails', async () => {
    stubFetch([{ turnId: 't1' }, { fail: true }]);
    await streamFirstTurnAndQueue();

    fireEvent.click(screen.getByLabelText('Send now'));

    // The send failed — the taken content lands back as the composer draft
    // (via the queue slots + the composer's restore effect), never lost.
    await waitFor(() => expect(textarea().value).toBe('queued text'));
  });
});
