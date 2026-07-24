import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHost } from '@/features/chat/chat-host';
import { useChatJobsStore } from '@/features/chat/chat-jobs-store';
import { useChatStore } from '@/stores/chat-store';

// ChatCard (rendered while open) calls useRouter() for ui:navigate events —
// needs a mock outside the real app-router tree, same as
// settings-form-regression.test.tsx.
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

describe('ChatHost', () => {
  beforeEach(() => {
    useChatStore.setState({ open: false, activeConversationId: null, streamingTurnId: null });
  });

  it('clicking the bubble opens the dialog and hides the bubble', async () => {
    renderHost();
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(await screen.findByRole('dialog', { name: 'sur9e chat' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open chat' })).toBeNull();
  });

  it('Escape closes the card and focus returns to the bubble', async () => {
    renderHost();
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    const dialog = await screen.findByRole('dialog', { name: 'sur9e chat' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open chat' })),
    );
  });

  it('the close button closes the card', async () => {
    renderHost();
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close chat' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// Persistent bubble error badge: a job that reaches 'error' while the chat
// is closed stays flagged red on the bubble (errorCount) until the chat is
// opened (the strip is seen) or the errored job is dismissed.
function resetJobsStore() {
  const s = useChatJobsStore.getState();
  for (const id of [...s.order]) s.dismiss(id);
}

describe('ChatHost — persistent bubble error badge', () => {
  beforeEach(() => {
    useChatStore.setState({
      open: false,
      minimizedByDrawer: false,
      activeConversationId: null,
      streamingTurnId: null,
    });
    resetJobsStore();
  });

  it('an error job with the chat CLOSED flags the bubble red', async () => {
    renderHost();
    act(() => {
      useChatJobsStore.getState().startJob('job-e', 'evaluate', 3);
      useChatJobsStore.getState().setSnapshot('job-e', { status: 'error', error: 'boom' });
    });
    expect(await screen.findByRole('button', { name: '1 job failed — open chat' })).toBeTruthy();
  });

  it('opening the chat acknowledges the error — bubble is plain again after close', async () => {
    renderHost();
    act(() => {
      useChatJobsStore.getState().startJob('job-e', 'evaluate', 3);
      useChatJobsStore.getState().setSnapshot('job-e', { status: 'error', error: 'boom' });
    });
    await screen.findByRole('button', { name: '1 job failed — open chat' });

    fireEvent.click(screen.getByRole('button', { name: '1 job failed — open chat' }));
    const dialog = await screen.findByRole('dialog', { name: 'sur9e chat' });
    await waitFor(() => expect(useChatJobsStore.getState().seenTerminalIds).toContain('job-e'));
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(await screen.findByRole('button', { name: 'Open chat' })).toBeTruthy();
  });

  it('a job that errors WHILE the chat is open is acknowledged immediately — never reaches the bubble', async () => {
    useChatStore.setState({ open: true });
    renderHost();
    await screen.findByRole('dialog', { name: 'sur9e chat' });

    act(() => {
      useChatJobsStore.getState().startJob('job-e', 'evaluate', 3);
      useChatJobsStore.getState().setSnapshot('job-e', { status: 'error', error: 'boom' });
    });
    await waitFor(() => expect(useChatJobsStore.getState().seenTerminalIds).toContain('job-e'));

    act(() => useChatStore.getState().closeChat());
    expect(await screen.findByRole('button', { name: 'Open chat' })).toBeTruthy();
  });

  it('dismissing the errored job clears the bubble badge', async () => {
    renderHost();
    act(() => {
      useChatJobsStore.getState().startJob('job-e', 'evaluate', 3);
      useChatJobsStore.getState().setSnapshot('job-e', { status: 'error', error: 'boom' });
    });
    await screen.findByRole('button', { name: '1 job failed — open chat' });

    act(() => useChatJobsStore.getState().dismiss('job-e'));

    expect(await screen.findByRole('button', { name: 'Open chat' })).toBeTruthy();
  });
});
