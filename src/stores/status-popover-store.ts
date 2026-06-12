'use client';

/**
 * stores/status-popover-store.ts
 *
 * Global open/close state for the status-change popover.
 *
 * The status popover is triggered from THREE different surfaces:
 *   1. Table row pill — wired locally in offers-table.tsx
 *   2. Drawer header pill — opens via this store
 *   3. Report renderer hero pill — opens via this store (HTML string,
 *      no React props; click delegation in ReportRender's effect)
 *
 * The host (<StatusPopoverHost />) lives once in layout.tsx and renders
 * the StatusPopover when state is set. onPick fires a PATCH and the
 * query invalidation refreshes whichever surface is visible.
 */

import { create } from 'zustand';

interface OpenArgs {
  anchor: HTMLElement;
  num: number;
  currentStatus: string;
}

interface StatusPopoverState {
  /** When set, <StatusPopoverHost /> renders the popover. */
  open: { anchor: HTMLElement; num: number; currentStatus: string } | null;
  show: (args: OpenArgs) => void;
  close: () => void;
}

export const useStatusPopoverStore = create<StatusPopoverState>(set => ({
  open: null,
  show: ({ anchor, num, currentStatus }) => set({ open: { anchor, num, currentStatus } }),
  close: () => set({ open: null }),
}));
