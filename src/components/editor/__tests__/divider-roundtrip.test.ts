import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { describe, expect, it } from 'vitest';

// T14: the divider (horizontalRule) is already wired into the + and turn-into
// menus via setHorizontalRule. This locks in that a `---` survives the
// markdown round-trip and renders as an <hr>, matching the zone-divider use in
// the report body (spec §3.2).

function makeEditor(content = '') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ horizontalRule: { HTMLAttributes: { class: 'be-hr' } } }),
      Markdown.configure({ html: true, tightLists: true, breaks: false }),
    ],
    content,
  });
}

function getMd(e: Editor) {
  return (e.storage as { markdown?: { getMarkdown(): string } }).markdown?.getMarkdown() ?? '';
}

describe('divider (horizontalRule) round-trip', () => {
  it('parses `---` to an hr and renders it', () => {
    const editor = makeEditor('Before\n\n---\n\nAfter');
    let hrs = 0;
    editor.state.doc.descendants(node => {
      if (node.type.name === 'horizontalRule') hrs += 1;
      return true;
    });
    expect(hrs).toBe(1);
    expect((editor.view.dom as HTMLElement).querySelectorAll('hr').length).toBe(1);
    editor.destroy();
  });

  it('serializes a horizontalRule back to a divider', () => {
    const editor = makeEditor('Before\n\n---\n\nAfter');
    const md = getMd(editor);
    // marked/markdown-it may emit --- or ___; accept any thematic break line.
    expect(/^(?:-{3,}|_{3,}|\*{3,})$/m.test(md)).toBe(true);
    editor.destroy();
  });
});
