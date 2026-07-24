import { create } from 'zustand';

// On-screen awareness (Part 1): the main surface the user is looking at
// publishes a concise, human-readable summary of what's on screen + where
// their focus is (active sort/filter/selection, the offer a report is for,
// per-column pipeline counts, …). The chat send-path reads this at send time
// and threads it into the turn as the `[context: …]` line, so the assistant
// reacts to the actual view instead of a bare pathname.
//
// One global slot: exactly one main surface is mounted at a time (App Router
// swaps route subtrees), so the last page to call setContext owns it. Pages
// wire this through useSetPageContext (src/hooks/use-page-context.ts), which
// clears the slot on unmount — an unmapped route that never sets it leaves
// `context` null and the send-path falls back to the pathname.
interface PageContextState {
  /** Null when no surface has published a summary — send-path falls back to the path. */
  context: string | null;
  setContext: (context: string | null) => void;
  clearContext: () => void;
}

export const usePageContextStore = create<PageContextState>(set => ({
  context: null,
  setContext: context => set({ context }),
  clearContext: () => set({ context: null }),
}));
