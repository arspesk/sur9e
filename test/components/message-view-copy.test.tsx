import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageView } from '@/features/chat/message-view';
import { ChatMessage } from '@/lib/schemas/chat';

// .parse() so future schema fields with defaults keep this fixture valid.
const assistantMsg = ChatMessage.parse({
  id: 'm1',
  conversationId: 'c1',
  role: 'assistant',
  content: 'Hello **world**',
  events: null,
  position: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
});
const userMsg = ChatMessage.parse({ ...assistantMsg, id: 'm0', role: 'user', position: 0 });

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
});

describe('message copy button', () => {
  it('copies the assistant markdown source and flashes Copied', async () => {
    render(<MessageView message={assistantMsg} />);
    fireEvent.click(screen.getByLabelText('Copy message'));
    expect(writeText).toHaveBeenCalledWith('Hello **world**');
    // Assistant copy is icon-only: the copied state swaps aria-label + glyph.
    await screen.findByLabelText('Copied');
  });

  it('user messages have no copy button', () => {
    render(<MessageView message={userMsg} />);
    expect(screen.queryByLabelText('Copy message')).toBeNull();
  });
});
