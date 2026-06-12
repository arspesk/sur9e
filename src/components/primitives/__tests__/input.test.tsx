import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '../input';

describe('Input', () => {
  it('renders with form-input class by default', () => {
    render(<Input aria-label="Email" />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('form-input');
  });

  it('adds is-invalid class and aria-invalid when invalid=true', () => {
    render(<Input aria-label="Email" invalid />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('is-invalid');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not add is-invalid class when invalid is not set', () => {
    render(<Input aria-label="Email" />);
    const input = screen.getByRole('textbox');
    expect(input.className).not.toContain('is-invalid');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('merges custom className', () => {
    render(<Input aria-label="Email" className="custom-class" />);
    expect(screen.getByRole('textbox').className).toContain('custom-class');
  });

  it('passes through native input props', () => {
    render(<Input aria-label="Email" placeholder="Enter email" disabled />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Enter email');
    expect(input).toBeDisabled();
  });

  it('omits form-input base class when bare=true', () => {
    render(<Input aria-label="Search" bare className="search filter-search" />);
    const input = screen.getByRole('textbox');
    expect(input.className).not.toContain('form-input');
    expect(input.className).toContain('search');
    expect(input.className).toContain('filter-search');
  });

  it('keeps is-invalid when bare=true and invalid=true', () => {
    render(<Input aria-label="Search" bare invalid />);
    const input = screen.getByRole('textbox');
    expect(input.className).not.toContain('form-input');
    expect(input.className).toContain('is-invalid');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
