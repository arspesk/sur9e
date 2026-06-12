import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Label } from '../label';

describe('Label', () => {
  it('renders with form-field__label class', () => {
    render(<Label>Name</Label>);
    const label = screen.getByText('Name');
    expect(label.className).toContain('form-field__label');
  });

  it('renders as a label element', () => {
    render(<Label htmlFor="name-input">Name</Label>);
    const label = screen.getByText('Name');
    expect(label.tagName.toLowerCase()).toBe('label');
    expect(label).toHaveAttribute('for', 'name-input');
  });

  it('merges custom className', () => {
    render(<Label className="extra-class">Email</Label>);
    expect(screen.getByText('Email').className).toContain('extra-class');
  });

  it('omits form-field__label base class when bare=true', () => {
    render(
      <Label bare className="custom-label">
        Name
      </Label>,
    );
    const label = screen.getByText('Name');
    expect(label.className).not.toContain('form-field__label');
    expect(label.className).toContain('custom-label');
  });

  it('renders as a span when as="span"', () => {
    render(
      <Label as="span" id="grp-label">
        Group label
      </Label>,
    );
    const el = screen.getByText('Group label');
    expect(el.tagName.toLowerCase()).toBe('span');
    expect(el).toHaveAttribute('id', 'grp-label');
    expect(el.className).toContain('form-field__label');
    // span variant should not accept htmlFor — TS prevents it, runtime sanity:
    expect(el).not.toHaveAttribute('for');
  });
});
