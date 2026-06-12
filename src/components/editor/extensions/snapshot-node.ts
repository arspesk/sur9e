import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { SnapshotNodeView } from '@/features/report/components/snapshot-node-view';

/**
 * Atom block node that marks the Snapshot widget's position in the body.
 * The visible widget (radar + score-breakdown card) is rendered by the
 * SnapshotNodeView React component via ReactNodeViewRenderer; this file
 * owns only the schema, the markdown round-trip serializer, and the
 * `div[data-snapshot]` parse rule.
 *
 * Markdown contract: round-trips as `<div data-snapshot></div>` — an HTML
 * block that tiptap-markdown (`html: true`) preserves through parse and
 * serialize. The h2 that visually labels the widget lives in the markdown
 * body itself (`## Snapshot`) and is walked by the TOC like any other
 * heading; the node holds no heading state.
 */
export const SnapshotNode = Node.create({
  name: 'snapshot',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-snapshot]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-snapshot': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SnapshotNodeView);
  },

  addStorage() {
    return {
      markdown: {
        // tiptap-markdown serializer state types are not exported.
        serialize(state: unknown, node: unknown) {
          const writer = state as { write: (s: string) => void; closeBlock: (n: unknown) => void };
          writer.write('<div data-snapshot></div>');
          writer.closeBlock(node);
        },
      },
    };
  },
});
