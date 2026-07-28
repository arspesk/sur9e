import { act, render } from '@testing-library/react';
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
});
