// Offers drawer collision (spec §6): the drawer opening over an open chat
// card auto-minimizes it to the bubble; the drawer closing restores it, but
// only when the drawer was what minimized it. A chat the user reopened or
// closed manually while the drawer was up must never resurrect itself.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHost } from '@/features/chat/chat-host';
import { useChatStore } from '@/stores/chat-store';
import { useDrawerStore } from '@/stores/drawer-store';

// ChatCard (rendered while open) calls useRouter() for ui:navigate events —
// needs a mock outside the real app-router tree, same as chat-host.test.tsx.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));

function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatHost />
    </QueryClientProvider>,
  );
}

describe('ChatHost — drawer auto-minimize', () => {
  beforeEach(() => {
    useChatStore.setState({
      open: false,
      minimizedByDrawer: false,
      activeConversationId: null,
      streamingTurnId: null,
    });
    useDrawerStore.setState({ open: false, num: null, siblings: null });
  });

  it('minimizes an open chat when the drawer opens', async () => {
    useChatStore.setState({ open: true });
    renderHost();
    await screen.findByRole('dialog', { name: 'sur9e chat' });

    act(() => useDrawerStore.setState({ open: true }));

    await waitFor(() => expect(useChatStore.getState().open).toBe(false));
    expect(useChatStore.getState().minimizedByDrawer).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('restores the chat when the drawer closes, if the drawer minimized it', async () => {
    useChatStore.setState({ open: false, minimizedByDrawer: false });
    useDrawerStore.setState({ open: true });
    renderHost();

    // Drawer opens over an open chat first, then closes again.
    act(() => useChatStore.setState({ open: true }));
    act(() => useDrawerStore.setState({ open: false }));
    act(() => useDrawerStore.setState({ open: true }));
    await waitFor(() => expect(useChatStore.getState().minimizedByDrawer).toBe(true));

    act(() => useDrawerStore.setState({ open: false }));

    await waitFor(() => expect(useChatStore.getState().open).toBe(true));
    expect(useChatStore.getState().minimizedByDrawer).toBe(false);
    expect(await screen.findByRole('dialog', { name: 'sur9e chat' })).toBeTruthy();
  });

  it('does not auto-restore a chat the user closed manually while the drawer was open', async () => {
    useChatStore.setState({ open: true });
    renderHost();
    await screen.findByRole('dialog', { name: 'sur9e chat' });

    act(() => useDrawerStore.setState({ open: true }));
    await waitFor(() => expect(useChatStore.getState().minimizedByDrawer).toBe(true));

    // User reopens the chat manually (bubble is visible again while minimized).
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(useChatStore.getState().minimizedByDrawer).toBe(false);

    // ...then closes it again manually.
    fireEvent.click(await screen.findByRole('button', { name: 'Close chat' }));
    expect(useChatStore.getState().open).toBe(false);
    expect(useChatStore.getState().minimizedByDrawer).toBe(false);

    act(() => useDrawerStore.setState({ open: false }));

    expect(useChatStore.getState().open).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a no-op when the drawer opens over an already-closed chat', async () => {
    useChatStore.setState({ open: false, minimizedByDrawer: false });
    renderHost();

    act(() => useDrawerStore.setState({ open: true }));

    expect(useChatStore.getState().open).toBe(false);
    expect(useChatStore.getState().minimizedByDrawer).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
