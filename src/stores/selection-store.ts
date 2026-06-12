import { create } from 'zustand';

interface SelectionState {
  selected: Set<number>;
  has: (num: number) => boolean;
  toggle: (num: number) => void;
  setAll: (nums: number[]) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selected: new Set<number>(),
  has: num => get().selected.has(num),
  toggle: num =>
    set(state => {
      const selected = new Set(state.selected);
      if (selected.has(num)) selected.delete(num);
      else selected.add(num);
      return { selected };
    }),
  setAll: nums => set({ selected: new Set(nums) }),
  clear: () => set({ selected: new Set() }),
}));
