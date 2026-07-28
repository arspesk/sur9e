import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-chat-sessions', () => ({
  useArchiveSession: () => ({ mutate: vi.fn() }),
  useChatSessions: () => ({
    data: [
      {
        id: 'thread-1',
        title: 'A deliberately long thread title that needs to fade at the edge',
        titleSource: 'manual',
        mode: null,
        archived: false,
        createdAt: '2026-07-28T10:00:00.000Z',
        updatedAt: '2026-07-28T10:00:00.000Z',
      },
    ],
  }),
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useRenameSession: () => ({ mutate: vi.fn() }),
}));

import { ChatThreadsSidebar } from '@/features/chat/chat-threads-sidebar';
import { useChatStore } from '@/stores/chat-store';

describe('ChatThreadsSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      useChatStore.getState().setActiveConversation('thread-1');
    });
  });

  it('keeps the thread list permanently expanded without a fold control', () => {
    localStorage.setItem('sur9e.chat.threads-collapsed', '1');
    const { container, queryByRole } = render(<ChatThreadsSidebar />);

    expect(queryByRole('button', { name: /collapse thread list|expand thread list/i })).toBeNull();
    expect(container.querySelector('.chat-threads')?.hasAttribute('data-collapsed')).toBe(false);
    expect(container.querySelector('.chat-threads__list')).toBeVisible();
  });

  it('starts at the approved 256px width with an accessible resize divider', () => {
    const { getByRole } = render(
      <div className="chat-page">
        <ChatThreadsSidebar />
      </div>,
    );

    const divider = getByRole('separator', { name: 'Resize thread list' });
    expect(divider).toHaveAttribute('aria-valuemin', '220');
    expect(divider).toHaveAttribute('aria-valuemax', '360');
    expect(divider).toHaveAttribute('aria-valuenow', '256');
    expect(divider.parentElement).toHaveStyle({ '--chat-thread-width': '256px' });
  });

  it('restores and updates the persisted width through keyboard resizing', async () => {
    localStorage.setItem('sur9e.chat.thread-width', '296');
    const { getByRole } = render(
      <div className="chat-page">
        <ChatThreadsSidebar />
      </div>,
    );
    const divider = getByRole('separator', { name: 'Resize thread list' });

    await waitFor(() => expect(divider).toHaveAttribute('aria-valuenow', '296'));
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });

    expect(divider).toHaveAttribute('aria-valuenow', '288');
    expect(divider.parentElement).toHaveStyle({ '--chat-thread-width': '288px' });
    expect(localStorage.getItem('sur9e.chat.thread-width')).toBe('288');
  });

  it('uses pointer capture while dragging and persists the clamped width', () => {
    const { getByRole } = render(
      <div className="chat-page">
        <ChatThreadsSidebar />
      </div>,
    );
    const divider = getByRole('separator', { name: 'Resize thread list' });
    divider.setPointerCapture = vi.fn();
    divider.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(divider, { pointerId: 7, clientX: 100 });
    fireEvent.pointerMove(divider, { pointerId: 7, clientX: 250 });
    fireEvent.pointerUp(divider, { pointerId: 7, clientX: 250 });

    expect(divider.setPointerCapture).toHaveBeenCalledWith(7);
    expect(divider.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(divider).toHaveAttribute('aria-valuenow', '360');
    expect(localStorage.getItem('sur9e.chat.thread-width')).toBe('360');
  });
});
