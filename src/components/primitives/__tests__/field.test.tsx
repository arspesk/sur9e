import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from '../field';

describe('Field', () => {
  it('renders children inside form-field wrapper', () => {
    const { container } = render(
      <Field>
        <input aria-label="name" />
      </Field>,
    );
    expect(container.firstChild).toHaveClass('form-field');
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('renders label when provided', () => {
    render(
      <Field label="Name" htmlFor="name">
        <input id="name" aria-label="name" />
      </Field>,
    );
    const label = screen.getByText('Name', { selector: 'label' });
    expect(label).toBeTruthy();
    expect(label).toHaveAttribute('for', 'name');
  });

  it('shows required asterisk when required=true', () => {
    render(
      <Field label="Email" required>
        <input aria-label="email" />
      </Field>,
    );
    expect(screen.getByText('*', { exact: false })).toBeTruthy();
  });

  it('renders helperText and error when provided', () => {
    render(
      <Field helperText="Hint text" error="Error message">
        <input aria-label="field" />
      </Field>,
    );
    expect(screen.getByText('Hint text')).toBeTruthy();
    expect(screen.getByText('Error message')).toBeTruthy();
  });

  it('does not render label when not provided', () => {
    const { container } = render(
      <Field>
        <input aria-label="field" />
      </Field>,
    );
    expect(container.querySelector('label')).toBeNull();
  });

  it('omits form-field wrapper class when bare=true', () => {
    const { container } = render(
      <Field bare className="bespoke-shell">
        <input aria-label="field" />
      </Field>,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).not.toContain('form-field');
    expect(wrapper.className).toContain('bespoke-shell');
  });
});
