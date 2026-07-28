import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatTranscript } from '@/features/chat/chat-transcript';
import type { ChatMessage } from '@/lib/schemas/chat';

function userMsg(id: string, content: string): ChatMessage {
  return {
    id,
    conversationId: 'c1',
    role: 'user',
    content,
    events: null,
    versionGroup: null,
    attachments: null,
    referencedOffers: null,
    position: 0,
    createdAt: '2026-07-19T00:00:00.000Z',
  };
}

function assistantMsg(id: string, content: string): ChatMessage {
  return {
    id,
    conversationId: 'c1',
    role: 'assistant',
    content,
    events: null,
    versionGroup: null,
    attachments: null,
    referencedOffers: null,
    position: 1,
    createdAt: '2026-07-19T00:00:00.000Z',
  };
}

/** jsdom never lays out geometry — stub scrollHeight/clientHeight so the
 * anchoring math (NEAR_BOTTOM_PX threshold, auto-follow) is exercisable. */
function stubGeometry(el: HTMLElement, { scrollHeight = 0, clientHeight = 0 } = {}) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
}

describe('ChatTranscript', () => {
  it('renders one MessageView per message, in order', () => {
    const messages = [userMsg('a', 'hi'), assistantMsg('b', 'hello back')];
    const { container } = render(
      <ChatTranscript
        messages={messages}
        pendingUserMessage={null}
        live={null}
        onRetry={() => {}}
      />,
    );
    const rows = container.querySelectorAll('.chat-msg');
    expect(rows.length).toBe(2);
    expect(rows[0].classList.contains('chat-msg--user')).toBe(true);
    expect(rows[1].classList.contains('chat-msg--assistant')).toBe(true);
  });

  it('renders the optimistic pending user message after persisted messages', () => {
    const { container, getByText } = render(
      <ChatTranscript
        messages={[userMsg('a', 'first')]}
        pendingUserMessage="just sent"
        live={null}
        onRetry={() => {}}
      />,
    );
    const rows = container.querySelectorAll('.chat-msg--user');
    expect(rows.length).toBe(2);
    expect(getByText('just sent')).toBeTruthy();
  });

  it('reconciles the optimistic echo once its persisted user message lands', () => {
    const pendingIdentity = { pendingUserMessageId: 'persisted' };
    const { container, getAllByText } = render(
      <ChatTranscript
        messages={[userMsg('persisted', 'just sent')]}
        pendingUserMessage="just sent"
        live={{ events: [], status: 'streaming' }}
        onRetry={() => {}}
        {...pendingIdentity}
      />,
    );

    expect(container.querySelectorAll('.chat-msg--user')).toHaveLength(1);
    expect(getAllByText('just sent')).toHaveLength(1);
  });

  it('renders a live turn as a busy assistant row while streaming', () => {
    const { container } = render(
      <ChatTranscript
        messages={[]}
        pendingUserMessage={null}
        live={{ events: [{ seq: 0, type: 'text-delta', text: 'partial' }], status: 'streaming' }}
        onRetry={() => {}}
      />,
    );
    const row = container.querySelector('.chat-msg--assistant');
    expect(row?.getAttribute('aria-busy')).toBe('true');
    expect(row?.textContent).toContain('partial');
  });

  it('does not mark the live row busy once the turn is done', () => {
    const { container } = render(
      <ChatTranscript
        messages={[]}
        pendingUserMessage={null}
        live={{ events: [{ seq: 0, type: 'text-delta', text: 'final' }], status: 'done' }}
        onRetry={() => {}}
      />,
    );
    const row = container.querySelector('.chat-msg--assistant');
    expect(row?.getAttribute('aria-busy')).toBeNull();
  });

  it('wires a retry callback for an error row inside the live turn', () => {
    const onRetry = vi.fn();
    const { getByRole } = render(
      <ChatTranscript
        messages={[]}
        pendingUserMessage={null}
        live={{ events: [{ seq: 0, type: 'error', message: 'boom' }], status: 'error' }}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no jump-to-bottom button while already at the bottom', () => {
    const { queryByRole } = render(
      <ChatTranscript
        messages={[userMsg('a', 'hi')]}
        pendingUserMessage={null}
        live={null}
        onRetry={() => {}}
      />,
    );
    expect(queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });

  it('shows the jump-to-bottom button once the user scrolls away from the bottom', () => {
    const { container, getByRole } = render(
      <ChatTranscript
        messages={[userMsg('a', 'hi')]}
        pendingUserMessage={null}
        live={null}
        onRetry={() => {}}
      />,
    );
    const el = container.querySelector('.chat-transcript') as HTMLDivElement;
    stubGeometry(el, { scrollHeight: 1000, clientHeight: 300 });
    el.scrollTop = 0;
    fireEvent.scroll(el);
    expect(getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
  });

  it('clicking jump-to-bottom scrolls to the bottom and hides itself', () => {
    const { container, getByRole, queryByRole } = render(
      <ChatTranscript
        messages={[userMsg('a', 'hi')]}
        pendingUserMessage={null}
        live={null}
        onRetry={() => {}}
      />,
    );
    const el = container.querySelector('.chat-transcript') as HTMLDivElement;
    stubGeometry(el, { scrollHeight: 1000, clientHeight: 300 });
    el.scrollTop = 0;
    fireEvent.scroll(el);
    fireEvent.click(getByRole('button', { name: 'Jump to latest' }));
    expect(el.scrollTop).toBe(1000);
    expect(queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });

  it('auto-follows growth to the bottom while the user stays at the bottom', () => {
    const { container, rerender } = render(
      <ChatTranscript messages={[]} pendingUserMessage={null} live={null} onRetry={() => {}} />,
    );
    const el = container.querySelector('.chat-transcript') as HTMLDivElement;
    stubGeometry(el, { scrollHeight: 500, clientHeight: 300 });
    rerender(
      <ChatTranscript
        messages={[]}
        pendingUserMessage={null}
        live={{ events: [{ seq: 0, type: 'text-delta', text: 'x' }], status: 'streaming' }}
        onRetry={() => {}}
      />,
    );
    expect(el.scrollTop).toBe(500);
  });

  it('does not force scroll while the user has scrolled away from the bottom', () => {
    const { container, rerender } = render(
      <ChatTranscript
        messages={[userMsg('a', 'hi')]}
        pendingUserMessage={null}
        live={null}
        onRetry={() => {}}
      />,
    );
    const el = container.querySelector('.chat-transcript') as HTMLDivElement;
    stubGeometry(el, { scrollHeight: 1000, clientHeight: 300 });
    el.scrollTop = 100;
    fireEvent.scroll(el); // atBottom -> false (1000 - 100 - 300 = 600 >= 48)
    el.scrollTop = 123; // simulate the user holding a manual scroll position
    rerender(
      <ChatTranscript
        messages={[userMsg('a', 'hi')]}
        pendingUserMessage={null}
        live={{ events: [{ seq: 0, type: 'text-delta', text: 'x' }], status: 'streaming' }}
        onRetry={() => {}}
      />,
    );
    expect(el.scrollTop).toBe(123);
  });

  it('pins the just-sent message to the top exactly once when a reply starts streaming', () => {
    const { container, rerender } = render(
      <ChatTranscript messages={[]} pendingUserMessage="hello" live={null} onRetry={() => {}} />,
    );
    const el = container.querySelector('.chat-transcript') as HTMLDivElement;
    const pin = container.querySelector('.chat-msg--user') as HTMLDivElement;
    stubGeometry(el, { scrollHeight: 999, clientHeight: 300 });
    Object.defineProperty(pin, 'offsetTop', { value: 120, configurable: true });

    // Turn starts streaming with no events yet — liveLen stays 0, so only
    // the pin effect (dep: streaming) should move the scroll position.
    rerender(
      <ChatTranscript
        messages={[]}
        pendingUserMessage="hello"
        live={{ events: [], status: 'streaming' }}
        onRetry={() => {}}
      />,
    );
    expect(el.scrollTop).toBe(112);

    // As the reply grows, auto-follow (already at bottom) takes over.
    rerender(
      <ChatTranscript
        messages={[]}
        pendingUserMessage="hello"
        live={{ events: [{ seq: 0, type: 'text-delta', text: 'x' }], status: 'streaming' }}
        onRetry={() => {}}
      />,
    );
    expect(el.scrollTop).toBe(999);
  });

  it('re-arms the pin for the next turn after the current one finishes', () => {
    const { container, rerender } = render(
      <ChatTranscript messages={[]} pendingUserMessage="first" live={null} onRetry={() => {}} />,
    );
    const el = container.querySelector('.chat-transcript') as HTMLDivElement;
    // Same host node is reused across rerenders below (text-only changes),
    // so stubbing it once is enough to observe both pin events.
    const pin = container.querySelector('.chat-msg--user') as HTMLDivElement;
    stubGeometry(el, { scrollHeight: 999, clientHeight: 300 });
    Object.defineProperty(pin, 'offsetTop', { value: 50, configurable: true });

    // Turn 1 starts streaming (no events yet) — pin fires.
    rerender(
      <ChatTranscript
        messages={[]}
        pendingUserMessage="first"
        live={{ events: [], status: 'streaming' }}
        onRetry={() => {}}
      />,
    );
    expect(el.scrollTop).toBe(42);

    // Turn 1 finishes (still no events, so auto-follow doesn't also fire) —
    // the pin flag resets.
    rerender(
      <ChatTranscript
        messages={[]}
        pendingUserMessage="first"
        live={{ events: [], status: 'done' }}
        onRetry={() => {}}
      />,
    );

    // Turn 2 starts streaming against a repositioned pin target — fires again.
    Object.defineProperty(pin, 'offsetTop', { value: 200, configurable: true });
    rerender(
      <ChatTranscript
        messages={[]}
        pendingUserMessage="second"
        live={{ events: [], status: 'streaming' }}
        onRetry={() => {}}
      />,
    );
    expect(el.scrollTop).toBe(192);
  });
});
