import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IconButton } from '../icon-button';

describe('IconButton', () => {
  it('renders with icon-btn class by default', () => {
    render(<IconButton icon={<span />} label="Close" />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.className).toContain('icon-btn');
  });

  it('sets aria-label from label prop', () => {
    render(<IconButton icon={<span />} label="Delete item" />);
    expect(screen.getByRole('button', { name: 'Delete item' })).toBeTruthy();
  });

  it('defaults to type="button"', () => {
    render(<IconButton icon={<span />} label="Close" />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('applies danger variant class', () => {
    render(<IconButton icon={<span />} label="Remove" variant="danger" />);
    expect(screen.getByRole('button').className).toContain('icon-btn--danger');
  });

  it('disables button when loading', () => {
    render(<IconButton icon={<span />} label="Save" loading />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
