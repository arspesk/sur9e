import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FieldPopover } from '../field-popover';

describe('FieldPopover', () => {
  it('renders options and fires onPick with the chosen value', () => {
    const onPick = vi.fn();
    const anchor = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchor} type="button">
          trigger
        </button>
        <FieldPopover
          current="Senior"
          options={[
            { key: 'Mid', label: 'Mid' },
            { key: 'Senior', label: 'Senior' },
          ]}
          anchorRef={anchor}
          onPick={onPick}
          onClose={() => {}}
          ariaLabel="Change seniority"
        />
      </>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mid' }));
    expect(onPick).toHaveBeenCalledWith('Mid');
  });

  it('returns focus to the anchor when an option is picked', () => {
    // Picking unmounts the portaled popover (and the focused menuitem with
    // it) — without an explicit re-focus, keyboard focus drops to <body>.
    const anchor = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchor} type="button">
          trigger
        </button>
        <FieldPopover
          current="Senior"
          options={[
            { key: 'Mid', label: 'Mid' },
            { key: 'Senior', label: 'Senior' },
          ]}
          anchorRef={anchor}
          onPick={() => {}}
          onClose={() => {}}
          ariaLabel="Change seniority"
        />
      </>,
    );
    const item = screen.getByRole('menuitem', { name: 'Mid' });
    item.focus();
    fireEvent.click(item);
    expect(document.activeElement).toBe(anchor.current);
  });

  it('marks the current option', () => {
    const anchor = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchor} type="button">
          t
        </button>
        <FieldPopover
          current="Senior"
          options={[{ key: 'Senior', label: 'Senior' }]}
          anchorRef={anchor}
          onPick={() => {}}
          onClose={() => {}}
          ariaLabel="x"
        />
      </>,
    );
    expect(screen.getByRole('menuitem', { name: 'Senior' })).toHaveClass('is-current');
  });
});
