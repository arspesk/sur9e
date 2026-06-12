// Fit-column colorizer (T12). Tints the cells of a table column headed "Fit"
// by their strength token (direct / strong / adjacent / gap), matching the
// VALID_STRENGTH enum used by the report schema and the spec §4 role-summary
// format.
//
// This runs in the EDITABLE report body (a ProseMirror editor), so it must not
// mutate the DOM directly — that would fight ProseMirror and corrupt the doc on
// the next edit. Instead it adds a
// node decoration (a class on the <td>), which is non-destructive and survives
// editing. CSS in tiptap-editor.css turns the class into the tint.

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const FIT_CLASS: Record<string, string> = {
  direct: 'be-fit-direct',
  strong: 'be-fit-strong',
  adjacent: 'be-fit-adjacent',
  gap: 'be-fit-gap',
};

function fitDecorations(doc: PMNode): Decoration[] {
  const decos: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;

    // Column index whose header cell reads "Fit" (case-insensitive).
    const headerRow = node.maybeChild(0);
    let fitCol = -1;
    headerRow?.forEach((cell, _off, i) => {
      if ((cell.textContent || '').trim().toLowerCase() === 'fit') fitCol = i;
    });
    if (fitCol === -1) return false; // no Fit column; don't descend

    node.forEach((row, rowOffset, rowIndex) => {
      if (rowIndex === 0) return; // header row
      const rowContentStart = pos + 1 + rowOffset + 1; // +1 table content, +1 into row
      row.forEach((cell, cellOffset, cellIndex) => {
        if (cellIndex !== fitCol) return;
        const token = (cell.textContent || '').trim().toLowerCase();
        const cls = FIT_CLASS[token];
        if (!cls) return;
        const cellStart = rowContentStart + cellOffset;
        decos.push(Decoration.node(cellStart, cellStart + cell.nodeSize, { class: cls }));
      });
    });
    return false; // simple report tables only; don't descend into nested content
  });

  return decos;
}

const fitColorizerKey = new PluginKey('fitColorizer');

export const FitColorizer = Extension.create({
  name: 'fitColorizer',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: fitColorizerKey,
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, fitDecorations(state.doc));
          },
        },
      }),
    ];
  },
});
