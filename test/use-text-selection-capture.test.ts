import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  selectionToCapture,
  shouldClearOnDeselect,
  useTextSelectionCapture,
} from '@/hooks/use-text-selection-capture';
import { useChatStore } from '@/stores/chat-store';

/** Minimal Selection stub — the guard only reads toString() + anchorNode. */
function fakeSelection(text: string, anchorNode: Node | null): Selection {
  return { toString: () => text, anchorNode } as unknown as Selection;
}

/** A live text node inside `container` (appended to the document so closest()
 * walks a real ancestor chain). */
function textNodeIn(container: HTMLElement): Text {
  const node = document.createTextNode('some selected text');
  container.append(node);
  document.body.append(container);
  return node;
}

afterEach(() => {
  document.body.replaceChildren();
});

// ── selectionToCapture guard ────────────────────────────────────────────────

describe('selectionToCapture', () => {
  it('captures a valid selection when the chat is OPEN, trimming whitespace', () => {
    const node = textNodeIn(document.createElement('div'));
    expect(selectionToCapture(fakeSelection('  hello world  ', node), true)).toBe('hello world');
  });

  it('captures nothing while the chat is CLOSED', () => {
    const node = textNodeIn(document.createElement('div'));
    expect(selectionToCapture(fakeSelection('hello world', node), false)).toBeNull();
  });

  it('ignores selections shorter than the minimum length', () => {
    const node = textNodeIn(document.createElement('div'));
    expect(selectionToCapture(fakeSelection('ab', node), true)).toBeNull();
  });

  it('ignores a null selection / empty text', () => {
    expect(selectionToCapture(null, true)).toBeNull();
    const node = textNodeIn(document.createElement('div'));
    expect(selectionToCapture(fakeSelection('   ', node), true)).toBeNull();
  });

  it('ignores selections inside the chat card (.chat-card)', () => {
    const card = document.createElement('div');
    card.className = 'chat-card';
    const node = textNodeIn(card);
    expect(selectionToCapture(fakeSelection('assistant said this', node), true)).toBeNull();
  });

  it('ignores selections inside a contenteditable editor', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const node = textNodeIn(editor);
    expect(selectionToCapture(fakeSelection('editing this text', node), true)).toBeNull();
  });

  it('ignores selections inside a form field (textarea)', () => {
    const ta = document.createElement('textarea');
    document.body.append(ta);
    // anchorNode is the textarea element itself → closest() matches self.
    expect(selectionToCapture(fakeSelection('typed value', ta), true)).toBeNull();
  });
});

// ── shouldClearOnDeselect decision ──────────────────────────────────────────

describe('shouldClearOnDeselect', () => {
  it('KEEPS the chip while the chat is closed (never acts collapsed)', () => {
    expect(shouldClearOnDeselect(document.body, false)).toBe(false);
  });

  it('KEEPS the chip when focus moved INTO the chat card (typing about it)', () => {
    const card = document.createElement('div');
    card.className = 'chat-card';
    const input = document.createElement('textarea');
    card.append(input);
    document.body.append(card);
    // Focus landed on the composer textarea, which lives inside .chat-card.
    expect(shouldClearOnDeselect(input, true)).toBe(false);
  });

  it('CLEARS the chip when the selection was dropped on the page', () => {
    // Focus is nowhere in particular (page body) → the user deselected in-page.
    expect(shouldClearOnDeselect(document.body, true)).toBe(true);
    expect(shouldClearOnDeselect(null, true)).toBe(true);
  });
});

// ── useTextSelectionCapture deselect-cancel listener ────────────────────────
//
// Integration: mount the hook, drive `selectionchange` with a stubbed
// window.getSelection, and assert the staged chip is cleared or kept based on
// where focus lands. The store slice itself (single-chip replace/no-op) is
// covered in chat-store.test.ts.

describe('useTextSelectionCapture deselect-cancel listener', () => {
  let selectionText = '';

  /** Fire a `selectionchange` with the page currently holding `text` selected
   * ('' models an empty / collapsed selection). */
  function selectionChangeTo(text: string) {
    selectionText = text;
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
  }

  beforeEach(() => {
    selectionText = '';
    vi.stubGlobal('getSelection', () => ({
      toString: () => selectionText,
      isCollapsed: selectionText.length === 0,
    }));
    useChatStore.setState({ open: true, selections: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    (document.activeElement as HTMLElement | null)?.blur?.();
    useChatStore.setState({ open: false, selections: [] });
  });

  it('drops the chip when the selection is cleared on the PAGE', () => {
    const { unmount } = renderHook(() => useTextSelectionCapture());
    // Creation gesture: a non-empty selectionchange arms the transition guard,
    // then the mouseup capture stages the chip.
    selectionChangeTo('a highlighted passage');
    act(() => useChatStore.getState().addSelection('a highlighted passage'));
    // User clicks empty page space → selection collapses, focus stays on page.
    (document.activeElement as HTMLElement | null)?.blur?.();
    selectionChangeTo('');
    act(() => vi.runOnlyPendingTimers());
    expect(useChatStore.getState().selections).toEqual([]);
    unmount();
  });

  it('KEEPS the chip when focus moves INTO the chat card (clicked the composer)', () => {
    const card = document.createElement('div');
    card.className = 'chat-card';
    const input = document.createElement('textarea');
    card.append(input);
    document.body.append(card);
    const { unmount } = renderHook(() => useTextSelectionCapture());
    selectionChangeTo('a highlighted passage');
    act(() => useChatStore.getState().addSelection('a highlighted passage'));
    // Clicking the composer moves focus into .chat-card AND collapses the page
    // selection — the chip must survive.
    input.focus();
    selectionChangeTo('');
    act(() => vi.runOnlyPendingTimers());
    expect(useChatStore.getState().selections).toEqual(['a highlighted passage']);
    unmount();
  });

  it('a freshly-staged chip survives an empty event with no prior selection', () => {
    const { unmount } = renderHook(() => useTextSelectionCapture());
    // A stray/initial empty selectionchange (e.g. the gesture's mousedown) must
    // NOT arm a clear — only a real non-empty → empty transition does.
    selectionChangeTo('');
    act(() => useChatStore.getState().addSelection('a fresh selection'));
    act(() => vi.runOnlyPendingTimers());
    expect(useChatStore.getState().selections).toEqual(['a fresh selection']);
    unmount();
  });

  it('never touches the chip while the chat is closed', () => {
    useChatStore.setState({ open: false, selections: ['staged'] });
    const { unmount } = renderHook(() => useTextSelectionCapture());
    selectionChangeTo('a highlighted passage');
    selectionChangeTo('');
    act(() => vi.runOnlyPendingTimers());
    expect(useChatStore.getState().selections).toEqual(['staged']);
    unmount();
  });
});
