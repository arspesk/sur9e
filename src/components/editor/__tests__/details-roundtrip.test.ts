import { Editor } from '@tiptap/core';
import { DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { describe, expect, it } from 'vitest';
import { applyToggle, DetailsBlock as Details } from '../extensions/details-block';

// The collapsible block is the official @tiptap/extension-details. This locks
// in that a details block survives the markdown serialize → parse round-trip
// (it serializes as <details> HTML; markdown-it with html:true re-parses it).

function makeEditor(content: unknown = '') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit,
      Details.configure({ persist: true, HTMLAttributes: { class: 'be-details' } }),
      DetailsSummary,
      DetailsContent,
      Markdown.configure({ html: true, tightLists: true, breaks: false }),
    ],
    content: content as string,
  });
}

function getMd(e: Editor) {
  return (e.storage as { markdown?: { getMarkdown(): string } }).markdown?.getMarkdown() ?? '';
}

const DOC = {
  type: 'doc',
  content: [
    {
      type: 'details',
      attrs: { open: true },
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'Why this works' }] },
        {
          type: 'detailsContent',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hidden detail.' }] }],
        },
      ],
    },
  ],
};

describe('details block markdown round-trip', () => {
  it('preserves summary + content through serialize → parse', () => {
    const md1 = getMd(makeEditor(DOC));
    expect(md1).toContain('<details');
    expect(md1).toContain('Why this works');
    expect(md1).toContain('Hidden detail.');

    const editor2 = makeEditor(md1);
    let details = 0;
    let summary = '';
    let content = '';
    editor2.state.doc.descendants(node => {
      if (node.type.name === 'details') details += 1;
      if (node.type.name === 'detailsSummary') summary = node.textContent;
      if (node.type.name === 'detailsContent') content = node.textContent;
      return true;
    });
    expect(details).toBe(1);
    expect(summary).toBe('Why this works');
    expect(content).toContain('Hidden detail.');
    editor2.destroy();
  });

  it('setDetails wraps the current block into a details node', () => {
    const editor = makeEditor('<p>Some text</p>');
    editor.commands.setTextSelection(2);
    (editor.commands as unknown as { setDetails: () => boolean }).setDetails();
    let details = 0;
    editor.state.doc.descendants(node => {
      if (node.type.name === 'details') details += 1;
      return true;
    });
    expect(details).toBe(1);
    editor.destroy();
  });

  it('applyToggle converts a heading into a toggle heading carrying its text into the summary', () => {
    const editor = makeEditor('<h2>My section</h2>');
    editor.commands.setTextSelection(2);
    applyToggle(editor, 'heading', 2);

    let details = 0;
    let summary = '';
    let kind: string | undefined;
    let headings = 0;
    editor.state.doc.descendants(node => {
      if (node.type.name === 'details') {
        details += 1;
        kind = node.attrs.kind as string;
      }
      if (node.type.name === 'detailsSummary') summary = node.textContent;
      if (node.type.name === 'heading') headings += 1;
      return true;
    });
    expect(details).toBe(1);
    expect(kind).toBe('heading');
    expect(summary).toBe('My section'); // the heading text moved into the summary
    expect(headings).toBe(0); // converted in place, no leftover heading
    editor.destroy();
  });

  it('round-trips the kind + level attrs (toggle heading)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'details',
          attrs: { open: true, kind: 'heading', level: 3 },
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: 'Round 2' }] },
            {
              type: 'detailsContent',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'detail' }] }],
            },
          ],
        },
      ],
    };
    const md = getMd(makeEditor(doc));
    expect(md).toContain('data-kind="heading"');
    expect(md).toContain('data-level="3"');

    const editor2 = makeEditor(md);
    let kind: string | undefined;
    let level: number | undefined;
    editor2.state.doc.descendants(node => {
      if (node.type.name === 'details') {
        kind = node.attrs.kind as string;
        level = node.attrs.level as number;
      }
      return true;
    });
    expect(kind).toBe('heading');
    expect(level).toBe(3);
    editor2.destroy();
  });

  it('preserves kind/level when the toggle button is clicked (collapse)', () => {
    // Regression: the stock Details toggle resets attrs to defaults on click,
    // so a heading toggle reverted to a plain box the moment it was collapsed.
    const editor = makeEditor('<h2>My section</h2>');
    editor.commands.setTextSelection(2);
    applyToggle(editor, 'heading', 2);

    const button = editor.view.dom.querySelector(
      '.be-details > button',
    ) as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    button?.click();

    let kind: string | undefined;
    let level: number | undefined;
    editor.state.doc.descendants(node => {
      if (node.type.name === 'details') {
        kind = node.attrs.kind as string;
        level = node.attrs.level as number;
      }
      return true;
    });
    expect(kind).toBe('heading'); // NOT reset to 'plain'
    expect(level).toBe(2);
    editor.destroy();
  });
});
