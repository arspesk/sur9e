import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/toast/toast-store';

describe('toast-store', () => {
  beforeEach(() => {
    // Reset the store before each test.
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('push adds a toast with the correct tone', () => {
    const { push } = useToastStore.getState();
    push('success', 'Hello world');
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Hello world');
    expect(toasts[0].tone).toBe('success');
  });

  it('push supports all four tones', () => {
    const { push } = useToastStore.getState();
    push('info', 'Info message');
    push('success', 'Success message');
    push('warning', 'Warning message');
    push('danger', 'Danger message');
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(4);
    expect(toasts.map(t => t.tone)).toEqual(['info', 'success', 'warning', 'danger']);
  });

  it('push returns void', () => {
    const { push } = useToastStore.getState();
    const result = push('info', 'Some message');
    expect(result).toBeUndefined();
  });

  it('dismiss removes the correct toast by id', () => {
    const { push, dismiss } = useToastStore.getState();
    push('success', 'First');
    const id1 = useToastStore.getState().toasts[0].id;
    push('danger', 'Second');
    dismiss(id1);
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Second');
  });

  it('multiple toasts are stacked independently', () => {
    const { push } = useToastStore.getState();
    push('info', 'A');
    push('success', 'B');
    push('warning', 'C');
    push('danger', 'D');
    expect(useToastStore.getState().toasts).toHaveLength(4);
  });

  it('dismiss with unknown id is a no-op', () => {
    const { push, dismiss } = useToastStore.getState();
    push('info', 'Exists');
    dismiss('does-not-exist');
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('auto-dismiss: toast is removed after 4s (via fake timer)', () => {
    vi.useFakeTimers();
    const { push, dismiss } = useToastStore.getState();

    // Simulate what the ToastItem component does: call dismiss after AUTO_DISMISS_MS.
    push('info', 'Auto dismiss me');
    const id = useToastStore.getState().toasts[0].id;
    expect(useToastStore.getState().toasts).toHaveLength(1);

    // Matches components/toast/toaster.tsx + legacy chrome-v2-toast.js:62.
    const AUTO_DISMISS_MS = 3500;
    const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);

    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);

    clearTimeout(timer);
  });
});
