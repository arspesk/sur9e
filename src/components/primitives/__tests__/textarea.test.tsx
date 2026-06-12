import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Textarea } from '../textarea';

describe('Textarea', () => {
  it('renders with form-input class by default', () => {
    render(<Textarea aria-label="Notes" />);
    expect(screen.getByRole('textbox').className).toContain('form-input');
  });

  it('adds is-invalid class and aria-invalid when invalid=true', () => {
    render(<Textarea aria-label="Notes" invalid />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('is-invalid');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not add is-invalid when invalid is false', () => {
    render(<Textarea aria-label="Notes" invalid={false} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.className).not.toContain('is-invalid');
  });

  it('merges custom className', () => {
    render(<Textarea aria-label="Notes" className="extra" />);
    expect(screen.getByRole('textbox').className).toContain('extra');
  });

  it('passes through native textarea props', () => {
    render(<Textarea aria-label="Notes" rows={5} disabled />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('rows', '5');
    expect(textarea).toBeDisabled();
  });

  it('omits form-input base class when bare=true', () => {
    render(<Textarea aria-label="Notes" bare className="custom-area" />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.className).not.toContain('form-input');
    expect(textarea.className).toContain('custom-area');
  });

  it('keeps is-invalid when bare=true and invalid=true', () => {
    render(<Textarea aria-label="Notes" bare invalid />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.className).not.toContain('form-input');
    expect(textarea.className).toContain('is-invalid');
  });
});
