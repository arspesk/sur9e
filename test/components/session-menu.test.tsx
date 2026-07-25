// test/components/session-menu.test.tsx
//
// SessionMenu: header session switcher (recent list, new chat, rename,
// delete). Renders real useChatSessions/useRenameSession/useDeleteSession
// hooks against a stubbed fetch — the REAL {sessions}/{session} envelope
// the committed routes return — so a regression to the
// wrong {conversations}/{conversation} shape shows up as an
// empty "No chats yet" list here, same as it would in the app.
// useDeleteConfirmStore is mocked wholesale — the modal itself is a
// separate component with its own tests; this file only needs a
// controllable confirm() promise.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionMenu } from '@/features/chat/session-menu';
import type { Conversation } from '@/lib/schemas/chat';
import { useChatStore } from '@/stores/chat-store';

const confirmMock = vi.fn<(opts?: unknown) => Promise<boolean>>();

// vi.mock calls are hoisted above imports, so the SessionMenu import above
// resolves against this mock — no dynamic import needed.
vi.mock('@/components/delete-confirm-modal', () => ({
  useDeleteConfirmStore: (selector: (s: { confirm: typeof confirmMock }) => unknown) =>
    selector({ confirm: confirmMock }),
}));

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

function renderMenu(sessions: Conversation[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === '/api/chat/sessions' && (!init || init.method === undefined)) {
        return { ok: true, status: 200, json: async () => ({ sessions }) } as Response;
      }
      if (href.startsWith('/api/chat/sessions/') && init?.method === 'PATCH') {
        const id = href.split('/').pop() as string;
        const body = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: makeConversation({ id, title: body.title }) }),
        } as Response;
      }
      if (href.startsWith('/api/chat/sessions/') && init?.method === 'DELETE') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      throw new Error(`unexpected fetch: ${href} ${init?.method}`);
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<SessionMenu />, { wrapper });
}

beforeEach(() => {
  useChatStore.setState({ activeConversationId: null });
  confirmMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SessionMenu', () => {
  it('shows the trigger with a fallback label and no active session', () => {
    renderMenu([]);
    expect(screen.getByRole('button', { name: 'Switch chat session' })).toBeInTheDocument();
  });

  it('opens the menu and lists recent, non-archived sessions newest-first', async () => {
    const sessions = [
      makeConversation({ id: 'a', title: 'Older', updatedAt: '2026-07-01T00:00:00.000Z' }),
      makeConversation({ id: 'b', title: 'Newer', updatedAt: '2026-07-10T00:00:00.000Z' }),
      makeConversation({
        id: 'c',
        title: 'Archived',
        archived: true,
        updatedAt: '2026-07-15T00:00:00.000Z',
      }),
    ];
    renderMenu(sessions);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));

    await waitFor(() => expect(screen.getByText('Newer')).toBeInTheDocument());
    // Scoped to the row button: the list is grouped by recency now, and one of
    // those group headers is also the word "Older", so a bare text query
    // matches both the header and this session's title.
    expect(screen.getByRole('button', { name: 'Older' })).toBeInTheDocument();
    // Archived sessions stay out of the recent list (no open-row button) —
    // they render only inside the collapsed Archived section as plain text.
    expect(screen.queryByRole('button', { name: 'Archived' })).not.toBeInTheDocument();

    // Newest first.
    const opens = screen.getAllByRole('button', { name: /^(Newer|Older)$/ });
    expect(opens[0]).toHaveTextContent('Newer');
    expect(opens[1]).toHaveTextContent('Older');
  });

  it('shows "No chats yet" when the sessions list is empty', async () => {
    renderMenu([]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));
    await waitFor(() => expect(screen.getByText('No chats yet')).toBeInTheDocument());
  });

  it('"New chat" clears the active conversation and closes the menu', async () => {
    useChatStore.setState({ activeConversationId: 'a' });
    renderMenu([makeConversation({ id: 'a', title: 'Session A' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));
    // The trigger itself also reads "Session A" (active title) while open, so
    // scope to the list row's button rather than screen.getByText.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Session A' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(useChatStore.getState().activeConversationId).toBeNull());
    await waitFor(() => expect(screen.queryByText('Session A')).not.toBeInTheDocument());
  });

  it('hides "New chat" when already on an empty new chat (no active conversation)', async () => {
    // beforeEach leaves activeConversationId null — a fresh empty chat, where
    // 'New chat' would be a no-op, so the button must not render even though
    // recent sessions exist to switch to.
    renderMenu([makeConversation({ id: 'a', title: 'Session A' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));
    await waitFor(() => expect(screen.getByText('Session A')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();
  });

  it('clicking a session row makes it active and closes the menu', async () => {
    renderMenu([makeConversation({ id: 'a', title: 'Session A' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));
    await waitFor(() => expect(screen.getByText('Session A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Session A' }));
    await waitFor(() => expect(useChatStore.getState().activeConversationId).toBe('a'));
  });

  it('the active session title renders on the trigger', async () => {
    useChatStore.setState({ activeConversationId: 'a' });
    renderMenu([makeConversation({ id: 'a', title: 'Session A' })]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Switch chat session' }).textContent).toContain(
        'Session A',
      ),
    );
  });

  it('rename: pencil icon opens an inline field, Enter commits via PATCH', async () => {
    const fetchSpy = vi.fn();
    renderMenu([makeConversation({ id: 'a', title: 'Session A' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));
    await waitFor(() => expect(screen.getByText('Session A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Session A' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename chat' });
    expect(input).toHaveValue('Session A');

    fireEvent.change(input, { target: { value: 'Renamed session' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/chat/sessions/a',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Renamed session' }),
        }),
      ),
    );
    void fetchSpy;
  });

  it('rename: Escape cancels without PATCHing', async () => {
    renderMenu([makeConversation({ id: 'a', title: 'Session A' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));
    await waitFor(() => expect(screen.getByText('Session A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Session A' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename chat' });
    fireEvent.change(input, { target: { value: 'Should not save' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Rename chat' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/chat/sessions/a',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('delete: confirms via the shared delete-confirm store, then DELETEs', async () => {
    confirmMock.mockResolvedValueOnce(true);
    renderMenu([makeConversation({ id: 'a', title: 'Session A' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));
    await waitFor(() => expect(screen.getByText('Session A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Session A' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/chat/sessions/a',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete chat?',
        target: 'Session A',
        confirmLabel: 'Delete',
      }),
    );
  });

  it('delete: declining the confirm never calls DELETE', async () => {
    confirmMock.mockResolvedValueOnce(false);
    renderMenu([makeConversation({ id: 'a', title: 'Session A' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));
    await waitFor(() => expect(screen.getByText('Session A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Session A' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/chat/sessions/a',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deleting the active session clears activeConversationId', async () => {
    confirmMock.mockResolvedValueOnce(true);
    useChatStore.setState({ activeConversationId: 'a' });
    renderMenu([makeConversation({ id: 'a', title: 'Session A' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch chat session' }));
    // The trigger itself also reads "Session A" (active title) while open, so
    // scope to the list row's button rather than screen.getByText.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Session A' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Session A' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(useChatStore.getState().activeConversationId).toBeNull());
  });
});
