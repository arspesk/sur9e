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

interface DeferredModal {
  modal: Exclude<ModalName, null>;
  context: Record<string, unknown> | null;
}

interface ModalState {
  modal: ModalName;
  context: Record<string, unknown> | null;
  deferred: DeferredModal[];
  open: (modal: Exclude<ModalName, null>, context?: Record<string, unknown> | null) => void;
  defer: (modal: Exclude<ModalName, null>, context?: Record<string, unknown> | null) => void;
  close: () => void;
}

export const useModalStore = create<ModalState>(set => ({
  modal: null,
  context: null,
  deferred: [],
  // Manual opens retain the existing replace-in-place behavior. Automatic
  // prompts use defer() below so an in-flight response cannot clobber one.
  open: (modal, context = null) => set({ modal, context: context ?? null }),
  defer: (modal, context = null) =>
    set(state => {
      const request = { modal, context: context ?? null };
      if (state.modal === null && state.deferred.length === 0) return request;
      return { deferred: [...state.deferred, request] };
    }),
  close: () =>
    set(state => {
      const [next, ...deferred] = state.deferred;
      return next
        ? { modal: next.modal, context: next.context, deferred }
        : { modal: null, context: null };
    }),
}));
