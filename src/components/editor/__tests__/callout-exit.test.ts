// Regression tests for the callout Enter-to-exit shortcut.
//
// The original handler computed `$from.after(d)` BEFORE chaining
// deleteRange, but insertContentAt resolves raw positions against the
// transaction's CURRENT doc — so the exit paragraph landed 2 positions too
// far and split the block after the callout. At the end of the doc, the
// delete-first order also collided with ProseMirror's replace fitter (which
// lifts a trailing paragraph out of the callout instead of removing it) and
// StarterKit's trailing-node paragraph, leaving two empty paragraphs.

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { CalloutNode } from '../extensions/callout-node';

function makeEditor(content: object) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit, CalloutNode],
    content,
  });
}

function pressEnter(editor: Editor) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
}

/** Top-level node shapes as `type(textContent)` for terse assertions. */
function shape(editor: Editor) {
  const out: string[] = [];
  editor.state.doc.forEach(n => {
    out.push(`${n.type.name}(${n.textContent})`);
  });
  return out;
}

const callout = (paras: string[]) => ({
  type: 'callout',
  content: paras.map(t => ({
    type: 'paragraph',
    content: t ? [{ type: 'text', text: t }] : [],
  })),
});
const para = (t: string) => ({
  type: 'paragraph',
  content: t ? [{ type: 'text', text: t }] : [],
});

describe('callout enter-to-exit', () => {
  it('exits into a fresh paragraph without splitting the following block', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [callout(['hello', '']), para('next')],
    });
    // Cursor inside the callout's empty trailing paragraph.
    editor.commands.setTextSelection(9);
    pressEnter(editor);
    expect(shape(editor)).toEqual(['callout(hello)', 'paragraph()', 'paragraph(next)']);
    // Cursor sits inside the freshly inserted exit paragraph.
    expect(editor.state.selection.from).toBe(10);
    editor.destroy();
  });

  it('callout at end of doc: exits into the trailing paragraph, leaving exactly one', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [callout(['hello', ''])],
    });
    // StarterKit's trailing-node plugin appends the empty paragraph after
    // the first transaction; setTextSelection triggers it (as typing would).
    editor.commands.setTextSelection(9);
    pressEnter(editor);
    expect(shape(editor)).toEqual(['callout(hello)', 'paragraph()']);
    expect(editor.state.selection.from).toBe(10);
    editor.destroy();
  });

  it('single empty-paragraph callout: adds an exit paragraph, never touches the next block', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [callout(['']), para('next')],
    });
    editor.commands.setTextSelection(2);
    pressEnter(editor);
    // block+ keeps an empty paragraph inside the callout; the key invariant
    // is that 'next' stays intact (the stale-position bug used to split it).
    expect(shape(editor)).toEqual(['callout()', 'paragraph()', 'paragraph(next)']);
    editor.destroy();
  });
});
