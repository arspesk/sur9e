import { describe, expect, it } from 'vitest';
import { useSelectionStore } from '@/stores/selection-store';

describe('selection store', () => {
  it('toggles and clears selected nums', () => {
    useSelectionStore.getState().clear();
    useSelectionStore.getState().toggle(10);
    expect(useSelectionStore.getState().has(10)).toBe(true);
    useSelectionStore.getState().toggle(10);
    expect(useSelectionStore.getState().has(10)).toBe(false);
  });
});
