import { Editor } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { describe, expect, it } from 'vitest';
import { FitColorizer } from '../extensions/fit-colorizer';

function makeEditor(content = '') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      FitColorizer,
      Markdown.configure({ html: true, tightLists: true, breaks: false }),
    ],
    content,
  });
}

const TABLE = [
  '| Requirement | Evidence | Fit |',
  '| --- | --- | --- |',
  '| Owns SE cycle | 20+ enterprise cycles | direct |',
  '| Restaurant domain | fintech background | gap |',
  '| Demos | tailored POCs | adjacent |',
].join('\n');

describe('FitColorizer', () => {
  it('tints the Fit column cells by strength token', () => {
    const editor = makeEditor(TABLE);
    const dom = editor.view.dom as HTMLElement;
    expect(dom.querySelector('td.be-fit-direct')?.textContent).toContain('direct');
    expect(dom.querySelector('td.be-fit-gap')?.textContent).toContain('gap');
    expect(dom.querySelector('td.be-fit-adjacent')?.textContent).toContain('adjacent');
    // Non-Fit cells get no tint class.
    const tinted = dom.querySelectorAll('td[class*="be-fit-"]');
    expect(tinted.length).toBe(3);
    editor.destroy();
  });

  it('does not tint a table without a Fit column', () => {
    const editor = makeEditor(['| A | B |', '| --- | --- |', '| direct | strong |'].join('\n'));
    const dom = editor.view.dom as HTMLElement;
    // "direct"/"strong" appear, but no column is headed "Fit", so no tint.
    expect(dom.querySelectorAll('td[class*="be-fit-"]').length).toBe(0);
    editor.destroy();
  });
});
