'use client';

import { useEffect } from 'react';
import { useChatStore } from '@/stores/chat-store';

// On-screen awareness (Part 2): while the chat is OPEN, a deliberate text
// selection anywhere on the page (outside the chat card and outside form
// fields) becomes a removable composer chip the assistant reacts to. Mounted
// once in the always-present chat root (ChatHost) so the listener lives for
// the whole session, but only ever captures while the card is open.

/** Minimum trimmed length of a selection worth capturing — filters out stray
 * clicks / a caret drag over a couple of characters. */
export const MIN_SELECTION_LENGTH = 4;

/** Light debounce after mouseup so a double-click or a quick re-selection
 * coalesces into a single capture (the selection persists after mouseup, so
 * reading it a beat later is faithful). */
const CAPTURE_DEBOUNCE_MS = 120;

/**
 * Pure capture guard — exported for tests. Returns the text to add, or null
 * when the selection must be ignored:
 *  - chat is closed (never capture while collapsed),
 *  - empty / shorter than MIN_SELECTION_LENGTH after trim,
 *  - the selection sits inside the chat card (`.chat-card`), or
 *  - inside a form field (`input` / `textarea` / `[contenteditable]`).
 *
 * The anchorNode's nearest element ancestor drives the containment checks
 * (a text node has no `.closest`).
 */
export function selectionToCapture(sel: Selection | null, open: boolean): string | null {
  if (!open || !sel) return null;
  const text = sel.toString().trim();
  if (text.length < MIN_SELECTION_LENGTH) return null;
  const node = sel.anchorNode;
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return null;
  // Selections the user makes inside the chat itself are the assistant's own
  // output / the composer draft — not something to feed back as context.
  if (el.closest('.chat-card')) return null;
  // Real form fields always own their text.
  if (el.closest('input, textarea')) return null;
  // Rich editors are for TYPING (profile / CV / narrative) — capturing there
  // echoes edits, not references. The report body is the exception: it's a
  // read-first evaluation, and selecting a passage to ask the assistant about
  // it is the primary use case — so allow it even though it's contenteditable.
  const editable = el.closest('[contenteditable]');
  if (editable && !editable.closest('.report-body')) return null;
  return text;
}

/**
 * Pure deselect-cancel decision — exported for tests. Called a tick after the
 * page selection has just collapsed to EMPTY; decides whether that empties the
 * staged chip. `activeElement` is `document.activeElement` at decision time.
 *
 *  - chat closed → false (the listener never acts while collapsed),
 *  - focus moved INTO the chat card (`.chat-card`, e.g. the user clicked the
 *    composer to type about the selection) → false, KEEP the chip,
 *  - otherwise the user cleared the selection on the PAGE → true, drop the chip.
 */
export function shouldClearOnDeselect(activeElement: Element | null, open: boolean): boolean {
  if (!open) return false;
  if (activeElement?.closest('.chat-card')) return false;
  return true;
}

export function useTextSelectionCapture(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let deselectTimer: ReturnType<typeof setTimeout> | null = null;
    // Tracks whether the page currently holds a non-empty selection, so we act
    // only on the non-empty → empty TRANSITION. The mouseup that creates a
    // selection also fires selectionchange (with a NON-empty range), so the
    // freshly-staged chip never sees an empty transition and always survives.
    let hadSelection = false;

    const onMouseUp = (e: MouseEvent) => {
      // Ignore mouseups INSIDE the chat (e.g. clicking a selection chip's ✕):
      // the page text may still be selected, so without this the click's own
      // mouseup would immediately re-capture the selection we just removed.
      const t = e.target;
      if (t instanceof Element && t.closest('.chat-card')) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const { open, addSelection } = useChatStore.getState();
        const text = selectionToCapture(window.getSelection(), open);
        if (text) addSelection(text);
      }, CAPTURE_DEBOUNCE_MS);
    };

    const onSelectionChange = () => {
      const sel = window.getSelection();
      const empty = !sel || sel.isCollapsed || sel.toString().trim().length === 0;
      if (!empty) {
        hadSelection = true;
        return;
      }
      // Now empty. Only a genuine non-empty → empty transition cancels the chip;
      // resting/repeated empty events are noise.
      if (!hadSelection) return;
      hadSelection = false;
      if (!useChatStore.getState().open) return; // only while the chat is open
      if (deselectTimer) clearTimeout(deselectTimer);
      // Defer a tick so focus settles: clicking the composer collapses the page
      // selection AND moves focus into the chat card, but that focus can land
      // after this selectionchange fires. Reading activeElement next tick makes
      // the KEEP-vs-clear decision faithful.
      deselectTimer = setTimeout(() => {
        const { open, clearSelections } = useChatStore.getState();
        if (shouldClearOnDeselect(document.activeElement, open)) clearSelections();
      }, 0);
    };

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      if (timer) clearTimeout(timer);
      if (deselectTimer) clearTimeout(deselectTimer);
    };
  }, []);
}
