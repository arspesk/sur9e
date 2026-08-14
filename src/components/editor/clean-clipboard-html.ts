// Cleans the `text/html` ProseMirror puts on the clipboard so that copying
// from the report body (especially tables) yields clean, semantic HTML in
// rich-text targets (Gmail, Google Docs, Notion) instead of editor internals
// like <colgroup>, resize handles, data-node ids, and be-* chrome (issue #67).
//
// Pure + DOM-based so it can be unit-tested directly; the editor wires it into
// a copy/cut listener (see tiptap-editor.tsx).

// Editor-only nodes that carry no content — dropped entirely.
const CHROME_SELECTOR = [
  'colgroup',
  '.column-resize-handle',
  '.be-handle',
  '.ProseMirror-separator',
  '.ProseMirror-trailingBreak',
  '.ProseMirror-gapcursor',
].join(',');

export function cleanClipboardHtml(html: string): string {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;

  for (const el of body.querySelectorAll(CHROME_SELECTOR)) el.remove();

  for (const el of body.querySelectorAll<HTMLElement>('*')) {
    // Editor chrome attributes that never belong in pasted content.
    el.removeAttribute('contenteditable');
    el.removeAttribute('draggable');
    el.removeAttribute('spellcheck');
    el.removeAttribute('class');
    el.removeAttribute('style');
    // All data-* attributes are editor internals (node ids, decorations, …).
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
    }
    // Drop redundant single-cell spans; keep real merges (>1).
    if (el.getAttribute('colspan') === '1') el.removeAttribute('colspan');
    if (el.getAttribute('rowspan') === '1') el.removeAttribute('rowspan');
  }

  return body.innerHTML;
}
