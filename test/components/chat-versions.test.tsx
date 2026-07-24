import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatTranscript } from '@/features/chat/chat-transcript';
import { ChatMessage } from '@/lib/schemas/chat';

const msg = (
  id: string,
  role: 'user' | 'assistant',
  position: number,
  versionGroup: string | null,
) =>
  ChatMessage.parse({
    id,
    conversationId: 'c1',
    role,
    content: `body of ${id}`,
    events: null,
    position,
    createdAt: '2026-01-01T00:00:00.000Z',
    versionGroup,
  });

const messages = [
  msg('u1', 'user', 0, null),
  msg('a1', 'assistant', 1, 'g1'),
  msg('a2', 'assistant', 2, 'g1'),
];

describe('reply versions', () => {
  it('shows the newest version by default and flips with the arrows', () => {
    render(
      <ChatTranscript
        messages={messages}
        pendingUserMessage={null}
        live={null}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('body of a2')).toBeTruthy();
    expect(screen.queryByText('body of a1')).toBeNull();
    expect(screen.getByText('2/2')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Previous version'));
    expect(screen.getByText('body of a1')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByLabelText('Previous version')).toHaveProperty('disabled', true);
  });

  it('regenerate button shows on the last assistant unit when idle', () => {
    const onRegenerate = vi.fn();
    render(
      <ChatTranscript
        messages={messages}
        pendingUserMessage={null}
        live={null}
        onRetry={() => {}}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByLabelText('Regenerate reply'));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
