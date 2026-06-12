import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HelperText } from '../helper-text';

describe('HelperText', () => {
  it('renders with form-field__hint class when children provided', () => {
    render(<HelperText>Use your full name</HelperText>);
    const el = screen.getByText('Use your full name');
    expect(el.className).toContain('form-field__hint');
    expect(el.tagName.toLowerCase()).toBe('small');
  });

  it('renders nothing when children is undefined', () => {
    const { container } = render(<HelperText />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when children is an empty string', () => {
    const { container } = render(<HelperText>{''}</HelperText>);
    expect(container.firstChild).toBeNull();
  });

  it('merges custom className', () => {
    render(<HelperText className="hint">Hint</HelperText>);
    expect(screen.getByText('Hint').className).toContain('hint');
  });

  it('omits form-field__hint base class when bare=true', () => {
    render(
      <HelperText bare className="custom-hint">
        Hint
      </HelperText>,
    );
    const el = screen.getByText('Hint');
    expect(el.className).not.toContain('form-field__hint');
    expect(el.className).toContain('custom-hint');
  });
});
