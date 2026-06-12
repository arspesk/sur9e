// Emoji picker for callouts. Opens when the user clicks a callout's emoji
// affordance OR picks "Edit icon" from the block-options (::) menu. Backed by
// emoji-mart's full searchable picker (all emojis), dynamically imported so it
// stays out of the initial editor bundle and only loads on first use.
//
// Callout COLOR is no longer handled here — it moved to the block menu's
// "Color" submenu (background-color row recolors the callout). This popover is
// emoji-only now.
//
// The picked emoji is written to the callout node's `emoji` attr via a
// ProseMirror transaction so tiptap-markdown re-emits the new `data-emoji`
// on the next save.

import type { Editor as TiptapEditor } from '@tiptap/core';

export interface CalloutPopoverHandle {
  /** Open the picker for the callout at `pos`, anchored to `anchorRect`. */
  openForPos: (pos: number, anchorRect: DOMRect) => void;
  destroy: () => void;
}

interface EmojiMartSelection {
  native?: string;
}

export function mountCalloutPopover(
  editor: TiptapEditor,
  editorEl: HTMLElement,
): CalloutPopoverHandle {
  const root = document.createElement('div');
  root.className = 'be-emoji-pop';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Pick an emoji');
  root.hidden = true;
  document.body.appendChild(root);

  // Track which callout pos the picker is bound to.
  let boundPos = -1;
  let pickerEl: HTMLElement | null = null;
  let pickerLoading = false;

  function applyEmoji(emoji: string) {
    if (boundPos < 0 || !emoji) return;
    const node = editor.state.doc.nodeAt(boundPos);
    if (!node || node.type.name !== 'callout') return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(boundPos, undefined, { ...node.attrs, emoji }),
    );
  }

  // Map a callout's DOM element to the document position of the callout NODE
  // itself. posAtDOM on the callout body lands inside the callout's content, so
  // we resolve that and walk ancestors up to the callout, returning the pos
  // just before it (so doc.nodeAt(pos) === the callout).
  function resolveCalloutPos(calloutDom: HTMLElement): number {
    const body = calloutDom.querySelector<HTMLElement>('.callout__body');
    const probe = body ?? calloutDom;
    let pos: number;
    try {
      pos = editor.view.posAtDOM(probe, 0);
    } catch {
      return -1;
    }
    if (pos < 0) return -1;
    const $pos = editor.state.doc.resolve(pos);
    for (let d = $pos.depth; d >= 0; d--) {
      if ($pos.node(d).type.name === 'callout') {
        return d === 0 ? 0 : $pos.before(d);
      }
    }
    return -1;
  }

  // Lazily build the emoji-mart picker. Returns once `pickerEl` is mounted.
  async function ensurePicker(): Promise<void> {
    if (pickerEl) return;
    if (pickerLoading) return;
    pickerLoading = true;
    try {
      const [mod, dataMod] = await Promise.all([import('emoji-mart'), import('@emoji-mart/data')]);
      // emoji-mart's Picker is a custom element at runtime (an HTMLElement),
      // but its types declare a plain class — cast through unknown to mount it.
      const PickerCtor = mod.Picker as unknown as new (props: Record<string, unknown>) => unknown;
      const picker = new PickerCtor({
        data: (dataMod as { default: unknown }).default,
        theme: 'auto',
        previewPosition: 'none',
        skinTonePosition: 'none',
        navPosition: 'top',
        autoFocus: true,
        onEmojiSelect: (e: EmojiMartSelection) => {
          if (e?.native) applyEmoji(e.native);
          close();
        },
      });
      pickerEl = picker as HTMLElement;
      root.appendChild(pickerEl);
    } finally {
      pickerLoading = false;
    }
  }

  function position(anchorRect: DOMRect) {
    const r = root.getBoundingClientRect();
    let top = anchorRect.bottom + 6;
    let left = anchorRect.left;
    if (top + r.height > window.innerHeight - 8) top = anchorRect.top - r.height - 6;
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8;
    root.style.top = `${Math.max(8, top)}px`;
    root.style.left = `${Math.max(8, left)}px`;
  }

  async function open(pos: number, anchorRect: DOMRect) {
    boundPos = pos;
    await ensurePicker();
    root.hidden = false;
    // Two rAFs: let the (shadow-DOM) picker lay out so getBoundingClientRect
    // returns real dimensions before we clamp the position to the viewport.
    requestAnimationFrame(() => requestAnimationFrame(() => position(anchorRect)));
    // Provisional placement for the first paint.
    position(anchorRect);
  }

  function close() {
    root.hidden = true;
    boundPos = -1;
  }

  function onDocMouseDown(e: MouseEvent) {
    if (root.hidden) return;
    const t = e.target as Node;
    if (root.contains(t)) return;
    if ((e.target as HTMLElement).closest('.callout__emoji')) return;
    close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  // Capture phase — fires before ProseMirror's own click handler which would
  // otherwise route selection to the contenteditable=false emoji span. Scoped
  // to this editor surface so multiple editors on one page (e.g. /profile) don't
  // cross-fire.
  function onDocClickCapture(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const emoji = target.closest<HTMLElement>('.callout__emoji');
    if (!emoji) return;
    if (!editorEl.contains(emoji)) return;
    e.preventDefault();
    e.stopPropagation();
    const callout = emoji.closest<HTMLElement>('div[data-callout]');
    if (!callout) return;
    // Resolve the callout's OWN position. posAtDOM on the callout body maps
    // into the callout's content (a child paragraph), so we resolve that pos
    // and walk ancestors up to the callout — `nodeAt(calloutPos)` is then the
    // callout itself. (Probing the outer NodeView dom returned a child pos,
    // which is why the old handler silently bailed: callout "not editable".)
    const calloutPos = resolveCalloutPos(callout);
    if (calloutPos < 0) return;
    void open(calloutPos, emoji.getBoundingClientRect());
  }

  document.addEventListener('click', onDocClickCapture, true);
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onKey);

  return {
    openForPos(pos, anchorRect) {
      void open(pos, anchorRect);
    },
    destroy() {
      document.removeEventListener('click', onDocClickCapture, true);
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
