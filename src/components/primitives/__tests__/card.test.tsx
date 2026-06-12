import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from '../card';

describe('Card', () => {
  it('renders with card class by default', () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.firstChild).toHaveClass('card');
  });

  it('does not add padding class when padding is not provided', () => {
    const { container } = render(<Card>Content</Card>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).not.toContain('card--p-');
  });

  it('applies padding class when padding is provided', () => {
    const { container } = render(<Card padding="md">Content</Card>);
    expect(container.firstChild).toHaveClass('card--p-md');
  });

  it('applies card--interactive when interactive=true', () => {
    const { container } = render(<Card interactive>Content</Card>);
    expect(container.firstChild).toHaveClass('card--interactive');
  });

  it('merges custom className', () => {
    const { container } = render(<Card className="my-card">Content</Card>);
    expect(container.firstChild).toHaveClass('my-card');
  });

  it('applies all variant classes together', () => {
    const { container } = render(
      <Card padding="lg" interactive className="extra">
        Content
      </Card>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('card');
    expect(el.className).toContain('card--p-lg');
    expect(el.className).toContain('card--interactive');
    expect(el.className).toContain('extra');
  });
});
