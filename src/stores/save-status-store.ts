import { create } from 'zustand';

// Shared save-state for the Profile + Settings auto-save forms. The
// page-head sub renders <SaveStateText/> from this store; the form hooks
// (use-profile-form / use-settings-form) write to it. idle → "Changes
// save as you type", saved → "✓ Saved" (reverts after the toast delay),
// error sticks until the next successful save.

export type SaveStatus = 'idle' | 'saved' | 'error';

interface SaveStatusState {
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
}

export const useSaveStatusStore = create<SaveStatusState>(set => ({
  status: 'idle',
  setStatus: status => set({ status }),
}));
