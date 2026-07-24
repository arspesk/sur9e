// test/components/chat-header.test.tsx
//
// ChatHeader: brand mark + session switcher + close button, with the
// (currently empty) Plan-4 jobs slot mounted directly below the row. Session
// switching (SessionMenu replacing the static title) lands in the next
// task — this only covers what ChatHeader itself composes today.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHeader } from '@/features/chat/chat-header';
import { useChatStore } from '@/stores/chat-store';

function renderHeader() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href === '/api/providers') {
        return { ok: true, status: 200, json: async () => ({ providers: {} }) } as Response;
      }
      if (href === '/api/settings') {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch: ${href}`);
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ChatHeader />, { wrapper });
}

beforeEach(() => {
  useChatStore.setState({ open: true, activeConversationId: null, modelOverride: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ChatHeader', () => {
  it('renders the brand mark, title, and close button', () => {
    const { container } = renderHeader();
    expect(container.querySelector('.chat-header__mark')).toBeTruthy();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    // The model chip moved to the composer; the header no longer carries it.
    expect(screen.queryByRole('button', { name: /Model:/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close chat' })).toBeInTheDocument();
  });

  it('close button calls closeChat, flipping the store to closed', async () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await waitFor(() => expect(useChatStore.getState().open).toBe(false));
  });

  it('mounts the (currently empty) jobs slot without rendering any extra content', async () => {
    const { container } = renderHeader();
    await waitFor(() => expect(screen.getByText('Chat')).toBeInTheDocument());
    // Only the header row's own elements exist — the jobs slot contributes
    // nothing to the DOM (Plan 4 fills it later).
    const header = container.querySelector('.chat-header');
    expect(header?.children).toHaveLength(1); // just .chat-header__row
  });
});
