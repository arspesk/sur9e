import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Pill } from '../pill';

describe('Pill', () => {
  it('renders with pill class by default', () => {
    render(<Pill>Applied</Pill>);
    const el = screen.getByText('Applied');
    expect(el.className).toContain('pill');
  });

  it('applies lowercased status class', () => {
    render(<Pill status="applied">Applied</Pill>);
    expect(screen.getByText('Applied').className).toContain('pill-applied');
  });

  it('normalizes status to lowercase and strips spaces', () => {
    render(<Pill status="In Review">In Review</Pill>);
    expect(screen.getByText('In Review').className).toContain('pill-inreview');
  });

  it('renders without status class when status is not provided', () => {
    render(<Pill>Default</Pill>);
    const el = screen.getByText('Default');
    expect(el.className).not.toContain('pill-');
  });

  it('merges custom className', () => {
    render(
      <Pill status="offer" className="extra">
        Offer
      </Pill>,
    );
    const el = screen.getByText('Offer');
    expect(el.className).toContain('pill-offer');
    expect(el.className).toContain('extra');
  });
});
