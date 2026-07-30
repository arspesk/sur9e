import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChatMarkdownView, FoldedEventList, MessageView } from '@/features/chat/message-view';
import type { ChatMessage } from '@/lib/schemas/chat';

// A MessageView carrying a `confirm` event folds in a ConfirmCard, which calls
// useQueryClient — so renders must sit under a QueryClientProvider. Wrapping
// every render (a fresh, retry-off client each) is harmless for the views that
// don't need it and keeps the call sites below untouched.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function userMsg(content: string, partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    role: 'user',
    content,
    events: null,
    versionGroup: null,
    attachments: null,
    referencedOffers: null,
    position: 0,
    createdAt: '2026-07-19T00:00:00.000Z',
    ...partial,
  };
}

function assistantMsg(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm2',
    conversationId: 'c1',
    role: 'assistant',
    content: '',
    events: null,
    versionGroup: null,
    attachments: null,
    referencedOffers: null,
    position: 1,
    createdAt: '2026-07-19T00:00:00.000Z',
    ...partial,
  };
}

describe('ChatMarkdownView', () => {
  it('renders sanitized markdown as HTML', () => {
    const { container } = render(<ChatMarkdownView markdown="**bold**" />);
    expect(container.querySelector('.chat-md strong')?.textContent).toBe('bold');
  });

  it('renders an inline report route as a clickable internal link', () => {
    const { container } = render(<ChatMarkdownView markdown={'Open `/report/88`'} />);
    const link = container.querySelector<HTMLAnchorElement>('.chat-md a');
    expect(link?.getAttribute('href')).toBe('/report/88');
    expect(link?.textContent).toBe('/report/88');
    expect(container.querySelector('.chat-md code')).toBeNull();
  });

  it('never raw-injects a script/html tag from model text', () => {
    const { container } = render(
      <ChatMarkdownView markdown={'before <script>alert(1)</script> after'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.chat-md')?.innerHTML).not.toContain('<script>');
  });
});

describe('MessageView', () => {
  it('renders a user message as a right-aligned bubble with plain text', () => {
    const { container, getByText } = render(<MessageView message={userMsg('hello there')} />);
    expect(container.querySelector('.chat-msg--user')).toBeTruthy();
    expect(getByText('hello there')).toBeTruthy();
  });

  it('renders an assistant message with no events as sanitized markdown', () => {
    const { container } = render(<MessageView message={assistantMsg({ content: 'plain *hi*' })} />);
    expect(container.querySelector('.chat-msg--assistant')).toBeTruthy();
    expect(container.querySelector('.chat-md em')?.textContent).toBe('hi');
  });

  it('renders an assistant message with events through the folded card set', () => {
    const events = [
      { seq: 0, type: 'text-delta', text: 'Working on it.' },
      { seq: 1, type: 'thinking', text: 'considering options' },
      { seq: 2, type: 'tool', name: 'Search', status: 'start' },
      { seq: 3, type: 'tool', name: 'Search', status: 'done' },
      { seq: 4, type: 'stage', label: 'Evaluating' },
      { seq: 5, type: 'confirm', token: 'tok1', summary: 'Approve X', meta: '~$0.10' },
      { seq: 6, type: 'usage', costUsd: 0.42, inputTokens: 1, outputTokens: 2, model: 'm' },
    ];
    const { container, getByText } = render(<MessageView message={assistantMsg({ events })} />);
    expect(container.querySelector('.chat-md')?.textContent).toContain('Working on it.');
    expect(container.querySelector('.chat-thinking')).toBeTruthy();
    expect(container.querySelector('.chat-tool')?.textContent).toContain('Search');
    expect(getByText('Evaluating')).toBeTruthy();
    expect(container.querySelector('.chat-confirm')).toBeTruthy();
    expect(getByText('· $0.42')).toBeTruthy();
  });

  it('renders an error row with a Retry button that invokes onRetry', () => {
    const events = [{ seq: 0, type: 'error', message: 'Turn failed' }];
    const onRetry = vi.fn();
    const { getByRole, getByText } = render(
      <MessageView message={assistantMsg({ events })} onRetry={onRetry} />,
    );
    expect(getByText('Turn failed')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders sent attachments: image thumbnails via the serving route, doc chips by name', () => {
    const { container, getByText } = render(
      <MessageView
        message={userMsg('see attached', {
          attachments: [
            { path: 'c1/a.png', name: 'shot.png', mime: 'image/png', size: 10 },
            { path: 'c1/b.pdf', name: 'cv.pdf', mime: 'application/pdf', size: 20 },
          ],
        })}
      />,
    );
    const img = container.querySelector('.chat-attach-chip__thumb') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/chat/uploads/c1/a.png');
    expect(getByText('shot.png')).toBeTruthy();
    expect(getByText('cv.pdf')).toBeTruthy();
    expect(container.querySelector('.chat-attach-chip__icon')).toBeTruthy();
    expect(getByText('PNG image')).toBeTruthy();
    expect(getByText('PDF file')).toBeTruthy();
    expect(container.querySelectorAll('.chat-attach-chip__meta')).toHaveLength(2);
    const userMessage = container.querySelector('.chat-msg--user');
    expect(userMessage?.children[0]).toHaveClass('chat-user-bubble');
    expect(userMessage?.children[1]).toHaveClass('chat-msg__attachments');
  });

  it('preserves full sent filenames while exposing compact truncation hooks', () => {
    const longName = 'CleanShot 2026-07-30 at 08.33.24@2x with recruiter location details.png';
    const { container, getByText } = render(
      <MessageView
        message={userMsg('that is what recruiter has said', {
          attachments: [
            { path: 'c1/long.png', name: longName, mime: 'image/png', size: 10 },
            { path: 'c1/notes.txt', name: 'notes.txt', mime: 'text/plain', size: 20 },
          ],
        })}
      />,
    );

    const attachments = container.querySelector('.chat-msg__attachments');
    expect(attachments?.querySelectorAll('.chat-attach-chip')).toHaveLength(2);
    expect(attachments?.querySelectorAll('.chat-attach-chip__body')).toHaveLength(2);
    expect(getByText(longName)).toHaveAttribute('title', longName);
  });

  it('renders no attachment row for a user message without attachments', () => {
    const { container } = render(<MessageView message={userMsg('plain')} />);
    expect(container.querySelector('.chat-msg__attachments')).toBeNull();
  });

  it('omits the usage row when cost is not yet known (null)', () => {
    const events = [
      { seq: 0, type: 'usage', costUsd: null, inputTokens: null, outputTokens: null, model: null },
    ];
    const { container } = render(<MessageView message={assistantMsg({ events })} />);
    expect(container.querySelector('.chat-usage')).toBeNull();
  });

  it('renders offer chips from persisted referencedOffers on a user message', () => {
    const { container } = render(
      <MessageView
        message={userMsg('compare @Linear #48 and @Attio #3', { referencedOffers: [48, 3] })}
      />,
    );
    const chips = [...container.querySelectorAll('.chat-offer-chip')].map(c => c.textContent);
    expect(chips).toEqual(['#48', '#3']);
  });

  it('renders no chips when referencedOffers is null', () => {
    const { container } = render(<MessageView message={userMsg('plain message')} />);
    expect(container.querySelector('.chat-msg__refs')).toBeNull();
  });
});

describe('FoldedEventList', () => {
  it('marks only the last item as streaming for the thinking block', () => {
    const items = [
      { kind: 'thinking' as const, text: 'first' },
      { kind: 'thinking' as const, text: 'second' },
    ];
    const { container } = render(<FoldedEventList items={items} streaming={true} />);
    const blocks = container.querySelectorAll('.chat-thinking');
    expect(blocks.length).toBe(2);
    // Streaming shimmer label only applies to the last block.
    expect(blocks[0].querySelector('.chat-thinking__label--shimmer')).toBeNull();
    expect(blocks[1].querySelector('.chat-thinking__label--shimmer')).toBeTruthy();
  });
});
