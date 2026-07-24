import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionMenu } from '@/features/chat/session-menu';
import { useChatStore } from '@/stores/chat-store';

const sessions = [
  {
    id: 'a1',
    title: 'Active one',
    mode: null,
    archived: false,
    createdAt: '',
    updatedAt: '2',
    titleSource: null,
  },
  {
    id: 'z9',
    title: 'Old thread',
    mode: null,
    archived: true,
    createdAt: '',
    updatedAt: '1',
    titleSource: null,
  },
];

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/chat/sessions' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ sessions }) } as Response;
      }
      if (/^\/api\/chat\/sessions\/[^/]+$/.test(url) && method === 'PATCH') {
        return { ok: true, status: 200, json: async () => ({ session: sessions[0] }) } as Response;
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }),
  );
}

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<SessionMenu />, { wrapper });
}

beforeEach(() => {
  stubFetch();
  useChatStore.setState({ activeConversationId: 'a1' });
});

describe('archive UI', () => {
  it('recent list hides archived; the Archived section lists them with unarchive', async () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('Switch chat session'));
    // The trigger also reads "Active one" (active title), so wait on the
    // list row's button rather than findByText.
    await screen.findByRole('button', { name: 'Active one' });
    expect(screen.queryByRole('button', { name: 'Old thread' })).toBeNull();
    fireEvent.click(screen.getByText(/^Archived \(1\)$/));
    await screen.findByText('Old thread');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Old thread' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unarchive' }));
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, init]) =>
            String(u) === '/api/chat/sessions/z9' &&
            (init as RequestInit)?.method === 'PATCH' &&
            String((init as RequestInit)?.body).includes('"archived":false'),
        ),
      ).toBe(true),
    );
  });

  it('archiving the ACTIVE thread clears the selection', async () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('Switch chat session'));
    // Same trigger/row duplication as above — scope to the row button.
    await screen.findByRole('button', { name: 'Active one' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Active one' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(useChatStore.getState().activeConversationId).toBeNull());
  });
});
