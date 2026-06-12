import { create } from 'zustand';

interface DrawerState {
  open: boolean;
  num: number | null;
  /**
   * Ordered list of row nums representing the navigation order for prev/next
   * — typically the current table sort/filter result, or the kanban column.
   * Snapshot at openDrawer() time. Stays stable across drawer life so the
   * user walks the SAME list they clicked into, even if the underlying
   * sort/filter changes mid-view.
   *
   * `null` means no caller-provided order — the drawer falls back to
   * filtering by status against the full applications list.
   */
  siblings: number[] | null;
  openDrawer: (num: number, siblings?: number[]) => void;
  closeDrawer: () => void;
}

export const useDrawerStore = create<DrawerState>(set => ({
  open: false,
  num: null,
  siblings: null,
  openDrawer: (num, siblings) =>
    set(state => ({
      open: true,
      num,
      // Only overwrite siblings when explicitly provided. The drawer's
      // internal prev/next handlers call openDrawer(nextNum) without a
      // siblings arg — they shouldn't nuke the snapshot the table or
      // kanban handed us when the drawer first opened.
      siblings: siblings === undefined ? state.siblings : siblings.length > 0 ? siblings : null,
    })),
  // Keep `num` so the drawer keeps rendering the current offer while it plays
  // its slide-out exit animation (OffersDrawer unmounts ~300ms after open flips
  // false). Without it the content would flash to a skeleton mid-slide. Clear
  // `siblings` so a later open without an explicit list can't reuse a stale
  // prev/next set; `num` is overwritten on the next openDrawer.
  closeDrawer: () => set({ open: false, siblings: null }),
}));
