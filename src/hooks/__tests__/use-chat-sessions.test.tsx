// src/hooks/__tests__/use-chat-sessions.test.tsx
//
// The committed routes (src/app/api/chat/sessions/route.ts,
// sessions/[id]/route.ts) return { sessions } / { session } — NOT the
// { conversations } / { conversation } shape an earlier draft assumed.
// These tests pin the REAL envelope so a future edit that reintroduces the
// wrong field name fails loudly instead of silently returning `undefined`
// (the exact "No chats yet" / TypeError-on-first-message failure mode the
// pre-flight scan predicted).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_SESSIONS_KEY,
  ChatApiError,
  chatFetch,
  chatSessionKey,
  useChatSession,
  useChatSessions,
  useCreateSession,
  useDeleteSession,
  useRenameSession,
} from '@/hooks/use-chat-sessions';
import type { Conversation } from '@/lib/schemas/chat';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    title: 'Untitled chat',
    titleSource: null,
    mode: null,
    archived: false,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('chatFetch', () => {
  it('resolves with the parsed JSON body on 2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) }) as Response,
      ),
    );
    await expect(chatFetch<{ hello: string }>('/api/x')).resolves.toEqual({ hello: 'world' });
  });

  it('throws ChatApiError with status/message/setupRequired from the error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 428,
            statusText: 'Precondition Required',
            json: async () => ({ error: 'onboarding incomplete', setupRequired: true }),
          }) as Response,
      ),
    );
    await expect(chatFetch('/api/x')).rejects.toMatchObject({
      name: 'ChatApiError',
      status: 428,
      setupRequired: true,
      message: 'onboarding incomplete',
    });
  });

  it('falls back to the status line when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => {
              throw new SyntaxError('not json');
            },
          }) as unknown as Response,
      ),
    );
    let caught: unknown;
    try {
      await chatFetch('/api/x');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ChatApiError);
    expect((caught as ChatApiError).message).toBe('500 Internal Server Error');
    expect((caught as ChatApiError).setupRequired).toBe(false);
  });
});

describe('useChatSessions', () => {
  it('reads the `sessions` field (not `conversations`) from GET /api/chat/sessions', async () => {
    const sessions = [makeConversation({ id: 'a' }), makeConversation({ id: 'b' })];
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, json: async () => ({ sessions }) }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useChatSessions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sessions);
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/sessions', expect.anything());
  });

  it('would silently return undefined forever if select read `.conversations` — guards the regression', async () => {
    const sessions = [makeConversation()];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sessions }) }) as Response),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useChatSessions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // If the hook read `.conversations` this would be `undefined`, not an array.
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data).toHaveLength(1);
  });
});

describe('useChatSession', () => {
  it('exposes `.session` and `.messages` from GET /api/chat/sessions/:id (not `.conversation`)', async () => {
    const session = makeConversation({ id: 'c1' });
    const messages = [
      {
        id: 'm1',
        conversationId: 'c1',
        role: 'user' as const,
        content: 'hi',
        events: null,
        position: 0,
        createdAt: '2026-07-18T00:00:00.000Z',
      },
    ];
    const fetchMock = vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ session, messages }) }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useChatSession('c1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.session).toEqual(session);
    expect(result.current.data?.messages).toEqual(messages);
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/sessions/c1', expect.anything());
  });

  it('does not fetch when id is null', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();
    renderHook(() => useChatSession(null), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useCreateSession', () => {
  it('POSTs and resolves `.session` (not `.conversation`), then invalidates the sessions list', async () => {
    const created = makeConversation({ id: 'new-1', title: 'New chat' });
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 201, json: async () => ({ session: created }) }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    const { client, wrapper } = makeWrapper();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateSession(), { wrapper });

    let resolved: { session: Conversation } | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync({ title: 'New chat' });
    });

    expect(resolved?.session).toEqual(created);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/sessions',
      expect.objectContaining({ method: 'POST' }),
    );
    const keys = spy.mock.calls.map(c => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(CHAT_SESSIONS_KEY));
  });
});

describe('useRenameSession', () => {
  it('PATCHes and invalidates both the list key and the per-session key', async () => {
    const renamed = makeConversation({ id: 'c1', title: 'Renamed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({ ok: true, status: 200, json: async () => ({ session: renamed }) }) as Response,
      ),
    );
    const { client, wrapper } = makeWrapper();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRenameSession(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'c1', title: 'Renamed' });
    });

    const keys = spy.mock.calls.map(c => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(CHAT_SESSIONS_KEY));
    expect(keys).toContain(JSON.stringify(chatSessionKey('c1')));
  });
});

describe('useDeleteSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DELETEs and invalidates the sessions list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response),
    );
    const { client, wrapper } = makeWrapper();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteSession(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('c1');
    });

    const keys = spy.mock.calls.map(c => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(CHAT_SESSIONS_KEY));
  });
});
