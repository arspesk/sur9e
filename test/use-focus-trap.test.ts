import { act, renderHook } from '@testing-library/react';
import { type RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from '@/hooks/use-focus-trap';

// Helper: create a real DOM container with focusable children.
function buildContainer(): { container: HTMLDivElement; buttons: HTMLButtonElement[] } {
  const container = document.createElement('div');
  const b1 = document.createElement('button');
  b1.textContent = 'First';
  const b2 = document.createElement('button');
  b2.textContent = 'Second';
  const b3 = document.createElement('button');
  b3.textContent = 'Third';
  container.append(b1, b2, b3);
  document.body.appendChild(container);
  return { container, buttons: [b1, b2, b3] };
}

function fireTab(shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

describe('useFocusTrap', () => {
  afterEach(() => {
    // Clean up DOM nodes appended during the test.
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('does not install handler when active=false', () => {
    const { container } = buildContainer();
    const ref = { current: container } as RefObject<HTMLDivElement>;
    const addSpy = vi.spyOn(document, 'addEventListener');

    const { unmount } = renderHook(() => useFocusTrap(ref, false));

    // Should not have added a keydown listener for the trap
    const kbCalls = addSpy.mock.calls.filter(c => c[0] === 'keydown');
    expect(kbCalls).toHaveLength(0);

    addSpy.mockRestore();
    unmount();
  });

  it('installs a keydown handler when active=true', () => {
    const { container } = buildContainer();
    const ref = { current: container } as RefObject<HTMLDivElement>;
    const addSpy = vi.spyOn(document, 'addEventListener');

    const { unmount } = renderHook(() => useFocusTrap(ref, true));

    const kbCalls = addSpy.mock.calls.filter(c => c[0] === 'keydown');
    expect(kbCalls.length).toBeGreaterThan(0);

    addSpy.mockRestore();
    unmount();
  });

  it('restores focus to previously focused element on unmount', () => {
    const { container } = buildContainer();
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    const ref = { current: container } as RefObject<HTMLDivElement>;
    const { unmount } = renderHook(() => useFocusTrap(ref, true));

    // After unmounting the trap, focus should return to trigger
    unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it('removes the keydown listener on unmount', () => {
    const { container } = buildContainer();
    const ref = { current: container } as RefObject<HTMLDivElement>;
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useFocusTrap(ref, true));
    unmount();

    const kbRemovals = removeSpy.mock.calls.filter(c => c[0] === 'keydown');
    expect(kbRemovals.length).toBeGreaterThan(0);
    removeSpy.mockRestore();
  });

  it('prevents Tab default when focus is on last element', () => {
    const { container, buttons } = buildContainer();
    const ref = { current: container } as RefObject<HTMLDivElement>;
    const { unmount } = renderHook(() => useFocusTrap(ref, true));

    buttons[2].focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    // Focus should have wrapped to the first element.
    expect(document.activeElement).toBe(buttons[0]);
    unmount();
  });

  it('prevents Shift+Tab default when focus is on first element', () => {
    const { container, buttons } = buildContainer();
    const ref = { current: container } as RefObject<HTMLDivElement>;
    const { unmount } = renderHook(() => useFocusTrap(ref, true));

    buttons[0].focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    // Focus should have wrapped to the last element.
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    unmount();
  });

  it('releases the trap on Escape so Tab is no longer confined (WCAG 2.1.2)', () => {
    const { container, buttons } = buildContainer();
    const ref = { current: container } as RefObject<HTMLDivElement>;
    const { unmount } = renderHook(() => useFocusTrap(ref, true));

    // Press Escape — the trap must release itself. Wrapped in act() so the
    // resulting state update flushes the effect cleanup (listener removal).
    act(() => {
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(escape);
    });

    // After release, a Tab from the last element must NOT be confined: the
    // handler should be gone, so preventDefault is never called and focus is
    // free to leave the container.
    buttons[2].focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    unmount();
  });
});
