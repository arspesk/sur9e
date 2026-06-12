// Notion-style toggle, built on the official @tiptap/extension-details engine
// (editable summary + content; Enter / Backspace / drag-handle all native, and
// markdown round-trips as <details>). A `kind` attribute styles the summary:
//   - plain   → a generic collapsible box
//   - heading → a toggle heading (summary uses h1/h2/h3 typography via `level`)
//   - list    → a toggle list (summary reads as a list item)
// Collapse/expand mechanics come from Details unchanged; only the summary look
// differs (CSS keys off data-kind / data-level). Set at creation via
// insertContent — the Details NodeView's update() only re-applies `open`, not
// other attrs, so changing kind after the fact would not re-render the DOM.

import type { Editor, NodeViewRendererProps } from '@tiptap/core';
import { Details } from '@tiptap/extension-details';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { Decoration, DecorationSource, NodeView } from '@tiptap/pm/view';

// Mirror the node's kind/level onto the live wrapper as data-attrs so the CSS
// (which keys off data-kind / data-level) can style the summary. The stock
// Details NodeView only re-syncs `open` on update, so we re-apply these here.
function syncKindAttrs(dom: HTMLElement, node: PMNode): void {
  const kind = node.attrs.kind as string | undefined;
  if (kind && kind !== 'plain') dom.setAttribute('data-kind', kind);
  else dom.removeAttribute('data-kind');
  if (kind === 'heading') dom.setAttribute('data-level', String(node.attrs.level || 2));
  else dom.removeAttribute('data-level');
}

// Convert the current top-level block into a Notion-style toggle: its inline
// content becomes the summary, the body starts as an empty paragraph, and the
// cursor lands IN the summary so typing fills the heading/list title. Used by
// both the slash menu (on the empty post-slash block) and the `::` "Turn into"
// menu (wraps an existing heading/paragraph). Attrs are set at creation so the
// Details NodeView renders data-kind/data-level (its update() only re-applies
// `open`, not other attrs).
export function applyToggle(editor: Editor, kind: 'heading' | 'list', level = 2): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const { $from } = state.selection;
      if ($from.depth < 1) return false;
      const block = $from.node(1);
      if (!block.isTextblock) return false;
      const { schema } = state;
      const summaryType = schema.nodes.detailsSummary;
      const contentType = schema.nodes.detailsContent;
      const detailsType = schema.nodes.details;
      const paragraph = schema.nodes.paragraph;
      if (!summaryType || !contentType || !detailsType || !paragraph) return false;

      const start = $from.before(1);
      const end = $from.after(1);
      const summary = summaryType.create(null, block.content);
      const content = contentType.create(null, paragraph.create());
      const details = detailsType.create({ open: true, kind, level }, [summary, content]);

      if (dispatch) {
        tr.replaceWith(start, end, details);
        // start +1 into details, +1 into summary → cursor in the summary text.
        tr.setSelection(TextSelection.near(tr.doc.resolve(start + 2)));
      }
      return true;
    })
    .run();
}

export const DetailsBlock = Details.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      kind: {
        default: 'plain',
        parseHTML: el => (el as HTMLElement).getAttribute('data-kind') || 'plain',
        renderHTML: attrs =>
          attrs.kind && attrs.kind !== 'plain' ? { 'data-kind': attrs.kind as string } : {},
      },
      level: {
        default: 2,
        parseHTML: el => Number((el as HTMLElement).getAttribute('data-level')) || 2,
        renderHTML: attrs =>
          attrs.kind === 'heading' ? { 'data-level': String(attrs.level || 2) } : {},
      },
    };
  },

  // Wrap the stock Details NodeView to fix two attr bugs:
  //   1. The built-in toggle button calls setNodeMarkup(pos, undefined, {open}),
  //      which RESETS every other attr (kind, level) to its schema default — so
  //      collapsing a heading toggle reverted it to a plain grey box. We
  //      intercept the click in the capture phase and flip `open` while keeping
  //      the rest of the attrs intact.
  //   2. The built-in update() only re-syncs `open`, never our data-kind /
  //      data-level — so we re-apply them after every update.
  addNodeView() {
    const parentNodeView = this.parent?.();
    const nodeType = this.type;
    return (props: NodeViewRendererProps): NodeView => {
      const view = parentNodeView?.(props) as NodeView | undefined;
      if (!view) throw new Error('DetailsBlock: missing parent NodeView');
      const dom = view.dom as HTMLElement;
      const { editor, getPos } = props;

      syncKindAttrs(dom, props.node);

      const button = dom.querySelector(':scope > button');
      if (button) {
        button.addEventListener(
          'click',
          event => {
            event.stopImmediatePropagation();
            event.preventDefault();
            if (typeof getPos !== 'function') return;
            const pos = getPos();
            if (pos == null) return;
            const current = editor.state.doc.nodeAt(pos);
            if (!current || current.type !== nodeType) return;
            editor
              .chain()
              .command(({ tr }) => {
                tr.setNodeMarkup(pos, undefined, { ...current.attrs, open: !current.attrs.open });
                return true;
              })
              .run();
          },
          true,
        );
      }

      const parentUpdate = view.update?.bind(view);
      return {
        ...view,
        update: (
          node: PMNode,
          decorations: readonly Decoration[],
          innerDecorations: DecorationSource,
        ) => {
          if (node.type !== nodeType) return false;
          const ok = parentUpdate ? parentUpdate(node, decorations, innerDecorations) : true;
          syncKindAttrs(dom, node);
          return ok;
        },
      };
    };
  },
});
