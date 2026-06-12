import { describe, expect, it } from 'vitest';
import { useSaveStatusStore } from '../save-status-store';

describe('save-status store', () => {
  it('defaults to idle and transitions', () => {
    expect(useSaveStatusStore.getState().status).toBe('idle');
    useSaveStatusStore.getState().setStatus('saved');
    expect(useSaveStatusStore.getState().status).toBe('saved');
    useSaveStatusStore.getState().setStatus('error');
    expect(useSaveStatusStore.getState().status).toBe('error');
    useSaveStatusStore.getState().setStatus('idle');
  });
});
