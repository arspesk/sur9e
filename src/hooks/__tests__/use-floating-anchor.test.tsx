/* use-floating-anchor.test.tsx — bottom-chrome floor measurement + the
 * dismiss-on-outside-scroll contract shared by every custom floating
 * surface (KebabActionsMenu, FieldPopover, ActionsMenu).
 *
 * jsdom has no layout engine, so bars are given explicit
 * getBoundingClientRect mocks; window.innerHeight in jsdom is 768.
 */

import { fireEvent } from '@testing-library/dom';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bottomChromeTop, useDismissOnScroll } from '../use-floating-anchor';

function addBar(className: string, top: number, height: number): HTMLElement {
  const el = document.createElement('nav');
  el.className = className;
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 375,
      width: 375,
      x: 0,
      y: top,
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('bottomChromeTop', () => {
  it('returns innerHeight when no bottom chrome is visible', () => {
    expect(bottomChromeTop()).toBe(window.innerHeight);
  });

  it('returns the top of a visible bottom-bar', () => {
    addBar('bottom-bar', 704, 64); // innerHeight 768 − 64
    expect(bottomChromeTop()).toBe(704);
  });

  it('ignores display:none chrome (0×0 box)', () => {
    addBar('bottom-bar', 0, 0); // jsdom default rect for hidden chrome
    expect(bottomChromeTop()).toBe(window.innerHeight);
  });

  it('ignores the batch action bar unless it is .on', () => {
    addBar('batch-action-bar', 690, 50); // off state: opacity 0 but measurable
    expect(bottomChromeTop()).toBe(window.innerHeight);
    addBar('batch-action-bar on', 690, 50);
    expect(bottomChromeTop()).toBe(690);
  });

  it('takes the highest (smallest top) of several visible bars', () => {
    addBar('bottom-bar', 704, 64);
    addBar('batch-action-bar on', 632, 50);
    expect(bottomChromeTop()).toBe(632);
  });
});

describe('useDismissOnScroll', () => {
  function setup(enabled = true) {
    const floating = document.createElement('aside');
    const inner = document.createElement('div');
    floating.appendChild(inner);
    document.body.appendChild(floating);
    const onClose = vi.fn();
    renderHook(() => useDismissOnScroll(enabled, { current: floating }, onClose));
    return { floating, inner, onClose };
  }

  it('closes on a scroll outside the floating surface', () => {
    const { onClose } = setup();
    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a scroll of an unrelated inner container (capture phase)', () => {
    const { onClose } = setup();
    const column = document.createElement('div');
    document.body.appendChild(column);
    fireEvent.scroll(column);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when the scroll originates inside the surface (cramped-fit maxHeight case)', () => {
    const { inner, onClose } = setup();
    fireEvent.scroll(inner);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on window resize', () => {
    const { onClose } = setup();
    fireEvent.resize(window);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does nothing while disabled (menus that stay mounted closed)', () => {
    const { onClose } = setup(false);
    fireEvent.scroll(document);
    fireEvent.resize(window);
    expect(onClose).not.toHaveBeenCalled();
  });
});
