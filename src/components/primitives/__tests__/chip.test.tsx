import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Chip } from '../chip';

describe('Chip', () => {
  it('renders with chip class by default', () => {
    render(<Chip>React</Chip>);
    const chip = screen.getByText('React');
    expect(chip.className).toContain('chip');
  });

  it('renders a button with chip--interactive when interactive=true', () => {
    render(<Chip interactive>React</Chip>);
    const el = screen.getByText('React');
    expect(el.tagName).toBe('BUTTON');
    expect(el.className).toContain('chip--interactive');
    expect((el as HTMLButtonElement).type).toBe('button');
  });

  it('forwards onClick when interactive', () => {
    const onClick = vi.fn();
    render(
      <Chip interactive onClick={onClick}>
        Filter
      </Chip>,
    );
    fireEvent.click(screen.getByText('Filter'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render remove button without onRemove', () => {
    render(<Chip>React</Chip>);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('renders remove button with onRemove and calls it on click', () => {
    const onRemove = vi.fn();
    render(<Chip onRemove={onRemove}>React</Chip>);
    const btn = screen.getByRole('button', { name: 'Remove' });
    expect(btn).toHaveAttribute('type', 'button');
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('merges custom className', () => {
    render(<Chip className="extra">Tag</Chip>);
    expect(screen.getByText('Tag').className).toContain('extra');
  });
});
