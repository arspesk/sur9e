import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { KebabActionsMenu, type KebabItem } from '../kebab-actions-menu';

describe('KebabActionsMenu', () => {
  it('renders items and fires onClick', () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    (ref as { current: HTMLButtonElement | null }).current = trigger;

    const items: KebabItem[] = [
      { label: 'A', onClick: onAction },
      { label: 'B', onClick: () => {}, danger: true },
    ];
    render(<KebabActionsMenu items={items} triggerRef={ref} onClose={onClose} />);
    fireEvent.click(screen.getByText('A'));
    expect(onAction).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    (ref as { current: HTMLButtonElement | null }).current = trigger;
    render(
      <KebabActionsMenu
        items={[{ label: 'A', onClick: () => {} }]}
        triggerRef={ref}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('cycles Tab focus within the menu instead of escaping it', () => {
    const ref = createRef<HTMLButtonElement>();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    (ref as { current: HTMLButtonElement | null }).current = trigger;
    render(
      <KebabActionsMenu
        items={[
          { label: 'A', onClick: () => {} },
          { label: 'B', onClick: () => {} },
        ]}
        triggerRef={ref}
        onClose={() => {}}
      />,
    );
    const items = screen.getAllByRole('menuitem');
    const last = items[items.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
  });
});
