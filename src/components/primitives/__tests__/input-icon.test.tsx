import { render, screen } from '@testing-library/react';
import { Mail } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Input } from '../input';

describe('Input icon prop', () => {
  it('renders without wrapper when no icon', () => {
    render(<Input aria-label="plain" />);
    const input = screen.getByLabelText('plain');
    expect(input.parentElement?.classList.contains('form-input-iconwrap')).toBe(false);
  });

  it('wraps with icon and pads the input', () => {
    render(<Input aria-label="email" icon={<Mail />} />);
    const input = screen.getByLabelText('email');
    expect(input.classList.contains('form-input--with-icon')).toBe(true);
    const wrap = input.parentElement;
    expect(wrap?.classList.contains('form-input-iconwrap')).toBe(true);
    // Icon is decorative
    expect(wrap?.querySelector('[aria-hidden="true"] svg, svg[aria-hidden="true"]')).toBeTruthy();
  });
});
