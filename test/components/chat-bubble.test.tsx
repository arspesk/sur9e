import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatBubble } from '@/features/chat/chat-bubble';

describe('ChatBubble', () => {
  it('idle: brand mark, no badge, no ring, plain label', () => {
    const { container, getByRole } = render(
      <ChatBubble open={false} jobCount={0} onClick={() => {}} />,
    );
    expect(container.querySelector('.chat-bubble__mark')).toBeTruthy();
    expect(container.querySelector('.chat-bubble__badge')).toBeNull();
    expect(container.querySelector('.chat-bubble__ring')).toBeNull();
    expect(getByRole('button', { name: 'Open chat' })).toBeTruthy();
  });

  it('busy: count badge + spinner ring + job-aware label', () => {
    const { container, getByRole } = render(
      <ChatBubble open={false} jobCount={2} onClick={() => {}} />,
    );
    expect(container.querySelector('.chat-bubble__badge')?.textContent).toBe('2');
    expect(container.querySelector('.chat-bubble__ring-arc')).toBeTruthy();
    expect(container.querySelector('.chat-bubble__ring-track')).toBeTruthy();
    expect(getByRole('button', { name: '2 jobs running — open chat' })).toBeTruthy();
  });

  it('singular job label', () => {
    const { getByRole } = render(<ChatBubble open={false} jobCount={1} onClick={() => {}} />);
    expect(getByRole('button', { name: '1 job running — open chat' })).toBeTruthy();
  });

  it('exposes aria-expanded from the open prop', () => {
    const { getByRole } = render(<ChatBubble open={true} jobCount={0} onClick={() => {}} />);
    expect(getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  // Persistent bubble error badge — a job that terminated in error while the
  // chat was closed stays flagged red on the bubble until the error is seen.
  it('renders the red error badge + failed label when errorCount>0 and jobCount===0', () => {
    const { container, getByRole } = render(
      <ChatBubble open={false} jobCount={0} errorCount={1} onClick={() => {}} />,
    );
    expect(container.querySelector('.chat-bubble__badge--error')?.textContent).toBe('1');
    expect(getByRole('button', { name: '1 job failed — open chat' })).toBeTruthy();
  });

  it('plural error label', () => {
    const { getByRole } = render(
      <ChatBubble open={false} jobCount={0} errorCount={3} onClick={() => {}} />,
    );
    expect(getByRole('button', { name: '3 jobs failed — open chat' })).toBeTruthy();
  });

  it('active jobs take precedence — no red badge while jobCount>0, even with an unseen error', () => {
    const { container, getByRole } = render(
      <ChatBubble open={false} jobCount={2} errorCount={1} onClick={() => {}} />,
    );
    expect(container.querySelector('.chat-bubble__badge--error')).toBeNull();
    expect(container.querySelector('.chat-bubble__badge')?.textContent).toBe('2');
    expect(getByRole('button', { name: '2 jobs running — open chat' })).toBeTruthy();
  });

  it('plain bubble when jobCount and errorCount are both 0', () => {
    const { container, getByRole } = render(
      <ChatBubble open={false} jobCount={0} errorCount={0} onClick={() => {}} />,
    );
    expect(container.querySelector('.chat-bubble__badge')).toBeNull();
    expect(container.querySelector('.chat-bubble__ring')).toBeNull();
    expect(getByRole('button', { name: 'Open chat' })).toBeTruthy();
  });

  it('renders the green done badge + finished label when only doneCount > 0', () => {
    const { container } = render(
      <ChatBubble open={false} jobCount={0} doneCount={2} onClick={() => {}} />,
    );
    expect(screen.getByLabelText('2 jobs finished — open chat')).toBeTruthy();
    expect(container.querySelector('.chat-bubble__badge--done')?.textContent).toBe('2');
    expect(container.querySelector('.chat-bubble__ring--done')).toBeTruthy();
  });

  it('error badge wins over done and carries the combined unseen count', () => {
    const { container } = render(
      <ChatBubble open={false} jobCount={0} errorCount={1} doneCount={2} onClick={() => {}} />,
    );
    expect(container.querySelector('.chat-bubble__badge--error')?.textContent).toBe('3');
    expect(container.querySelector('.chat-bubble__badge--done')).toBeNull();
  });

  it('active jobs win over both terminal badges', () => {
    const { container } = render(
      <ChatBubble open={false} jobCount={1} errorCount={1} doneCount={1} onClick={() => {}} />,
    );
    expect(container.querySelector('.chat-bubble__badge--error')).toBeNull();
    expect(container.querySelector('.chat-bubble__badge--done')).toBeNull();
    expect(container.querySelector('.chat-bubble__badge')?.textContent).toBe('1');
  });
});
