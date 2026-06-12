import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorText } from '../error-text';

describe('ErrorText', () => {
  it('renders with form-field__error class when children provided', () => {
    render(<ErrorText>This field is required</ErrorText>);
    const el = screen.getByText('This field is required');
    expect(el.className).toContain('form-field__error');
    expect(el.tagName.toLowerCase()).toBe('small');
  });

  it('renders nothing when children is undefined', () => {
    const { container } = render(<ErrorText />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when children is an empty string', () => {
    const { container } = render(<ErrorText>{''}</ErrorText>);
    expect(container.firstChild).toBeNull();
  });

  it('merges custom className', () => {
    render(<ErrorText className="extra">Error</ErrorText>);
    expect(screen.getByText('Error').className).toContain('extra');
  });

  it('omits form-field__error base class when bare=true', () => {
    render(
      <ErrorText bare className="custom-error">
        Error
      </ErrorText>,
    );
    const el = screen.getByText('Error');
    expect(el.className).not.toContain('form-field__error');
    expect(el.className).toContain('custom-error');
  });
});
