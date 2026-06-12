import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Separator } from '../separator';

describe('Separator', () => {
  it('renders with separator class by default', () => {
    const { container } = render(<Separator />);
    const hr = container.querySelector('hr');
    expect(hr).toBeTruthy();
    expect(hr?.className).toContain('separator');
  });

  it('does not add vertical class for horizontal orientation', () => {
    const { container } = render(<Separator orientation="horizontal" />);
    expect(container.querySelector('hr')?.className).not.toContain('separator--vertical');
  });

  it('adds separator--vertical class for vertical orientation', () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.querySelector('hr')?.className).toContain('separator--vertical');
  });

  it('merges custom className', () => {
    const { container } = render(<Separator className="my-sep" />);
    expect(container.querySelector('hr')?.className).toContain('my-sep');
  });
});
