import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StatusPill, statusLabel } from '../status-pill';

describe('statusLabel', () => {
  it('maps "skip" to "Discarded"', () => {
    expect(statusLabel('skip')).toBe('Discarded');
  });
  it('title-cases known statuses', () => {
    expect(statusLabel('evaluated')).toBe('Evaluated');
    expect(statusLabel('responded')).toBe('Responded');
  });
  it('maps "offer" to the disambiguated stage label', () => {
    expect(statusLabel('offer')).toBe('Offer received');
  });
  it('capitalizes unknown statuses as-is', () => {
    expect(statusLabel('archived')).toBe('Archived');
  });
  it('returns empty string for empty input', () => {
    expect(statusLabel('')).toBe('');
  });
});

describe('StatusPill', () => {
  it('renders a span by default with the pill class chain', () => {
    render(<StatusPill status="applied" />);
    const el = screen.getByText('Applied');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toContain('pill');
    expect(el.className).toContain('pill-applied');
  });

  it('maps "skip" to discarded label + discarded class', () => {
    render(<StatusPill status="skip" />);
    const el = screen.getByText('Discarded');
    expect(el.className).toContain('pill-discarded');
  });

  it('lowercases mixed-case status for the class suffix and the label lookup', () => {
    render(<StatusPill status="Interview" />);
    const el = screen.getByText('Interview');
    expect(el.className).toContain('pill-interview');
    expect(el.className).not.toContain('pill-Interview');
  });

  it('renders a button when interactive is true and forwards onClick', () => {
    const onClick = vi.fn();
    render(
      <StatusPill
        status="screened"
        interactive
        onClick={onClick}
        aria-haspopup="menu"
        aria-expanded={false}
        data-num={7}
      />,
    );
    const btn = screen.getByRole('button', { name: /screened/i });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('data-num')).toBe('7');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('honours disabled when interactive', () => {
    render(<StatusPill status="offer" interactive disabled />);
    const btn = screen.getByRole('button', { name: /offer/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('forwards ref to the underlying button when interactive', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<StatusPill ref={ref} status="interview" interactive />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('merges custom className with the canonical chain', () => {
    render(<StatusPill status="offer" className="drawer-status-trigger" />);
    const el = screen.getByText('Offer received');
    expect(el.className).toContain('pill');
    expect(el.className).toContain('pill-offer');
    expect(el.className).toContain('drawer-status-trigger');
  });
});
