import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThinkingBlock } from '@/features/chat/thinking-block';

describe('ThinkingBlock', () => {
  it('toggle has no aria-controls while collapsed (body not rendered)', () => {
    render(<ThinkingBlock text="reasoning…" streaming={false} />);
    const toggle = screen.getByRole('button', { name: 'Thinking' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
  });

  it('renders nothing once settled with no thinking text', () => {
    // An empty event still produced a chip, which opened onto blank space.
    const { container } = render(<ThinkingBlock text="   " streaming={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still shows the chip while streaming, before any text has arrived', () => {
    // The body fills delta by delta, and the chip carries the elapsed counter
    // in the meantime — so an empty text is expected here, not a defect.
    render(<ThinkingBlock text="" streaming={true} />);
    expect(screen.getByRole('button', { name: /Thinking… \d+s/ })).toBeInTheDocument();
  });

  it('expanding sets aria-controls on the toggle to the body element id', () => {
    render(<ThinkingBlock text="reasoning…" streaming={false} />);
    const toggle = screen.getByRole('button', { name: 'Thinking' });
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();

    const body = screen.getByText('reasoning…');
    expect(body.id).toBe(controlsId);
  });
});
