'use client';

/**
 * stores/overflow-menu-store.ts
 *
 * Global open/close state for the report Topbar overflow menu (kebab ⋮).
 *
 * Replaces the document-level [data-pill-overflow-trigger] click delegation
 * that OverflowMenu used to register. The trigger in report-page.tsx now
 * calls useOverflowMenuStore.getState().toggle({...}) from a proper React
 * onClick. The host (<OverflowMenu />) subscribes and positions itself
 * relative to the captured anchor.
 *
 */

import { create } from 'zustand';

interface OpenArgs {
  anchor: HTMLElement;
  num: number;
  company: string;
}

interface OverflowMenuState {
  open: OpenArgs | null;
  close: () => void;
  toggle: (args: OpenArgs) => void;
}

export const useOverflowMenuStore = create<OverflowMenuState>(set => ({
  open: null,
  close: () => set({ open: null }),
  toggle: args =>
    set(s => (s.open && s.open.anchor === args.anchor ? { open: null } : { open: args })),
}));
