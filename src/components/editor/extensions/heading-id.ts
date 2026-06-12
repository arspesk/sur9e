// Stamps stable `id` attributes on headings so the TOC rail can scroll to them.
//
// The previous approach set `h.id` directly on ProseMirror's managed DOM from a
// rAF on every keystroke. But `id` isn't part of the heading schema, so PM
// strips it on its next re-render; the following keystroke re-added it, PM's
// MutationObserver saw the foreign attribute change and re-rendered the nodes —
// recreating every <img> (refetch → 404 → collapse) and jumping the page on
// every keystroke. Node decorations are PM's own mechanism: they add the id
// during PM's render, so there's no foreign mutation and no re-render loop.

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Slug a heading title for the DOM id. MUST match buildTocFromMarkdown in
// report-body-editor.tsx (same slug + dedup) so rail ids line up with DOM ids.
function slug(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildHeadingIdDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  const seen = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    const text = node.textContent.trim();
    if (!text) return; // skip empty headings, like the TOC builder does
    const base = slug(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { id }));
  });
  return DecorationSet.create(doc, decorations);
}

const headingIdKey = new PluginKey<DecorationSet>('headingId');

export const HeadingId = Extension.create({
  name: 'headingId',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: headingIdKey,
        state: {
          init: (_config, { doc }) => buildHeadingIdDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? buildHeadingIdDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return headingIdKey.getState(state);
          },
        },
      }),
    ];
  },
});
