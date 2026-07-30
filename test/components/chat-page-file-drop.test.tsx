import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from '@/features/chat/chat-page';
import { useChatStore } from '@/stores/chat-store';

const setDraftFiles = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-chat-sessions', () => ({
  useChatSessions: () => ({ data: [] }),
}));

vi.mock('@/features/chat/chat-composer', () => ({
  ChatComposer: () => <div data-testid="composer" />,
}));

vi.mock('@/features/chat/chat-conversation-content', () => ({
  ChatConversationContent: () => <div data-testid="conversation" />,
}));

vi.mock('@/features/chat/chat-jobs-slot', () => ({
  ChatJobsSlot: () => null,
}));

vi.mock('@/features/chat/chat-threads-sidebar', () => ({
  ChatThreadsSidebar: () => null,
}));

vi.mock('@/features/chat/use-chat-url-sync', () => ({
  useChatUrlSync: () => undefined,
}));

vi.mock('@/features/chat/use-mobile-chat-redirect', () => ({
  useMobileChatRedirect: () => false,
}));

vi.mock('@/features/chat/use-conversation', () => ({
  useConversation: () => ({
    conversationStatus: 'ready',
    draftFiles: [],
    retry: vi.fn(),
    send: vi.fn(),
    sendError: null,
    setDraftFiles,
    stop: vi.fn(),
    streaming: false,
    turnStatus: 'idle',
  }),
}));

describe('ChatPage file drop', () => {
  beforeEach(() => {
    setDraftFiles.mockClear();
    useChatStore.setState({
      activeConversationId: null,
      chatEntryOrigin: null,
    });
  });

  it('adds files dropped on the full-page conversation to the draft', () => {
    const { container } = render(<ChatPage />);
    const conversation = container.querySelector('.chat-page__main');
    if (!(conversation instanceof HTMLElement)) throw new Error('conversation surface missing');
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });

    fireEvent.drop(conversation, {
      dataTransfer: { files: [file], types: ['Files'] },
    });

    expect(setDraftFiles).toHaveBeenCalledTimes(1);
    const update = setDraftFiles.mock.calls[0][0] as (previous: File[]) => File[];
    expect(update([])).toEqual([file]);
  });

  it('shows and clears the same drag-over state as the bubble chat', () => {
    const { container } = render(<ChatPage />);
    const conversation = container.querySelector('.chat-page__main');
    if (!(conversation instanceof HTMLElement)) throw new Error('conversation surface missing');
    const dataTransfer = { files: [], types: ['Files'] };

    fireEvent.dragOver(conversation, { dataTransfer });
    expect(conversation).toHaveAttribute('data-dragover');

    fireEvent.dragLeave(conversation, { dataTransfer });
    expect(conversation).not.toHaveAttribute('data-dragover');
  });
});
