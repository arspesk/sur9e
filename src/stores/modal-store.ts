import { create } from 'zustand';

/**
 * Central name registry for body-mounted modals. Each name maps 1:1 to a
 * component in components/modals/ (or to DeleteConfirmModal for 'delete',
 * which keeps its own promise-based store rather than using context).
 *
 * - 'apply'             — CLI handoff: shows `/sur9e apply <num>` + copy
 * - 'cv'                — Tailor-CV confirm modal (kicks off tailor-cv job)
 * - 'cover-letter'      — Cover-letter confirm modal (kicks off cover-letter job)
 * - 'evaluate'          — Evaluate confirm modal (kicks off evaluate job)
 * - 'followup'          — CLI handoff: shows `/sur9e followup <num>` + copy
 * - 'interview-process' — Interview-prep confirm modal
 * - 'outreach'          — Outreach confirm modal
 * - 'research'          — Company-research confirm modal
 * - 'negotiate'         — Negotiation-strategy confirm modal (kicks off negotiate job)
 * - 'screen'            — URL-paste modal for the Add menu (kicks off screen job)
 * - 'delete'            — Routed via the modal-host registry but the component
 *                         reads from useDeleteConfirmStore for back-compat.
 */
export type ModalName =
  | 'apply'
  | 'cv'
  | 'cover-letter'
  | 'evaluate'
  | 'followup'
  | 'interview-process'
  | 'outreach'
  | 'research'
  | 'negotiate'
  | 'screen'
  | 'delete'
  | null;

interface ModalState {
  modal: ModalName;
  context: Record<string, unknown> | null;
  open: (modal: Exclude<ModalName, null>, context?: Record<string, unknown> | null) => void;
  close: () => void;
}

export const useModalStore = create<ModalState>(set => ({
  modal: null,
  context: null,
  open: (modal, context = null) => set({ modal, context: context ?? null }),
  close: () => set({ modal: null, context: null }),
}));
