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

  it('dismisses when anything outside the menu scrolls (kanban column, drawer, page-scroll)', () => {
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
    const column = document.createElement('div');
    document.body.appendChild(column);
    fireEvent.scroll(column);
    expect(onClose).toHaveBeenCalled();
  });

  it('opens BELOW the trigger with internal scroll when the full menu does not fit (below-first convention)', () => {
    // jsdom: innerHeight 768; menu measures 500px tall via prototype stub.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
    const ref = createRef<HTMLButtonElement>();
    const trigger = document.createElement('button');
    // Mid-screen trigger: roomBelow 418 (< 500 natural) but usable → below + cap.
    trigger.getBoundingClientRect = () =>
      ({ top: 300, bottom: 336, left: 500, right: 540, width: 40, height: 36 }) as DOMRect;
    document.body.appendChild(trigger);
    (ref as { current: HTMLButtonElement | null }).current = trigger;
    render(
      <KebabActionsMenu
        items={[{ label: 'A', onClick: () => {} }]}
        triggerRef={ref}
        onClose={() => {}}
      />,
    );
    const menu = screen.getByRole('menu');
    expect(menu.style.top).toBe('342px'); // rect.bottom + 6 gap — BELOW
    expect(menu.style.maxHeight).toBe('418px'); // capped to the room below
    expect(menu.style.overflowY).toBe('auto');
    vi.restoreAllMocks();
  });

  it('flips ABOVE only when the room below is genuinely too tight', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
    const ref = createRef<HTMLButtonElement>();
    const trigger = document.createElement('button');
    // Near-bottom trigger: roomBelow 18 (unusable), roomAbove 686 → flip above.
    trigger.getBoundingClientRect = () =>
      ({ top: 700, bottom: 736, left: 500, right: 540, width: 40, height: 36 }) as DOMRect;
    document.body.appendChild(trigger);
    (ref as { current: HTMLButtonElement | null }).current = trigger;
    render(
      <KebabActionsMenu
        items={[{ label: 'A', onClick: () => {} }]}
        triggerRef={ref}
        onClose={() => {}}
      />,
    );
    const menu = screen.getByRole('menu');
    expect(menu.style.top).toBe('194px'); // rect.top - 500 - 6 gap — ABOVE
    vi.restoreAllMocks();
  });

  it('stays open when the scroll happens inside the menu (cramped-fit internal scrolling)', () => {
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
    fireEvent.scroll(screen.getByRole('menu'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
