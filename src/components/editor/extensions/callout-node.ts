// Notion-style callout block. NodeView-rendered so:
//   * the emoji affordance lives outside ProseMirror's editable surface
//     (its own non-editable button) — clicks on the emoji are owned by
//     the callout popover (callout-popover.ts), never by ProseMirror.
//   * the body has an explicit contentDOM so ProseMirror routes typing
//     and cursor placement into it reliably.
//
// Markdown round-trip uses an HTML <div data-callout ...> wrapper so the
// file stays valid GFM and any external viewer renders the tinted div.

import { mergeAttributes, Node } from '@tiptap/core';

export type CalloutVariant = 'info' | 'warn' | 'success' | 'error';

const DEFAULT_EMOJI: Record<CalloutVariant, string> = {
  info: '💡',
  warn: '⚠️',
  success: '✅',
  error: '🛑',
};

export const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  // `block+` lets the user nest lists, headings, multiple paragraphs etc.
  // inside the callout — matches Notion's permissive callout content.
  content: 'block+',
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: el => (el as HTMLElement).getAttribute('data-emoji') || DEFAULT_EMOJI.info,
        renderHTML: attrs => ({ 'data-emoji': (attrs.emoji as string) || DEFAULT_EMOJI.info }),
      },
      variant: {
        default: 'info' as CalloutVariant,
        parseHTML: el => (el as HTMLElement).getAttribute('data-variant') || 'info',
        renderHTML: attrs => ({ 'data-variant': (attrs.variant as string) || 'info' }),
      },
      // User-picked background color (from the block menu's Color submenu).
      // null = fall back to the variant's default tint (CSS-driven). When set,
      // it's an explicit color string that overrides the variant background.
      bg: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-bg') || null,
        renderHTML: attrs => (attrs.bg ? { 'data-bg': attrs.bg as string } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  // Used when ProseMirror serializes to HTML (and tiptap-markdown
  // serializes the same way when html:true is on). The NodeView controls
  // the live DOM; this just defines the file shape.
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': '',
        class: `callout callout--${(node.attrs.variant as string) || 'info'}`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, editor: _ed }) => {
      const dom = document.createElement('div');
      dom.dataset.callout = '';
      dom.dataset.variant = (node.attrs.variant as string) || 'info';
      dom.dataset.emoji = (node.attrs.emoji as string) || '💡';
      dom.className = `callout callout--${(node.attrs.variant as string) || 'info'}`;
      // Explicit background overrides the variant tint. Inline style beats the
      // variant class's CSS so the user's pick from the Color submenu wins.
      const initialBg = node.attrs.bg as string | null;
      if (initialBg) {
        dom.dataset.bg = initialBg;
        dom.style.background = initialBg;
      }

      // Emoji affordance — non-editable so ProseMirror never tries to
      // route the caret here. Click is owned by callout-popover.ts.
      const emojiEl = document.createElement('span');
      emojiEl.className = 'callout__emoji';
      emojiEl.contentEditable = 'false';
      emojiEl.textContent = (node.attrs.emoji as string) || '💡';
      dom.appendChild(emojiEl);

      // Body — contentDOM where ProseMirror puts the editable children.
      // No contenteditable=false here so it inherits true from the
      // editor root.
      const body = document.createElement('div');
      body.className = 'callout__body';
      dom.appendChild(body);

      return {
        dom,
        contentDOM: body,
        update(updatedNode) {
          if (updatedNode.type.name !== node.type.name) return false;
          const variant = (updatedNode.attrs.variant as string) || 'info';
          const emoji = (updatedNode.attrs.emoji as string) || '💡';
          const bg = updatedNode.attrs.bg as string | null;
          dom.dataset.variant = variant;
          dom.dataset.emoji = emoji;
          dom.className = `callout callout--${variant}`;
          if (bg) {
            dom.dataset.bg = bg;
            dom.style.background = bg;
          } else {
            delete dom.dataset.bg;
            dom.style.removeProperty('background');
          }
          if (emojiEl.textContent !== emoji) emojiEl.textContent = emoji;
          return true;
        },
      };
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter at the end of a callout's LAST empty paragraph exits the
      // callout into a fresh paragraph below. Otherwise plain Enter wins
      // so users can add new paragraphs inside.
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name !== 'callout') continue;
          const para = $from.node($from.depth);
          const isParagraph = para.type.name === 'paragraph';
          const isEmpty = para.content.size === 0;
          const idxInCallout = $from.index(d);
          const isLastChild = idxInCallout === n.childCount - 1;
          if (isParagraph && isEmpty && isLastChild) {
            const after = $from.after(d);
            // Cursor target inside the paragraph that follows the callout
            // once the empty in-callout paragraph (para.nodeSize) is gone.
            const exitPos = after - para.nodeSize + 1;
            const next = state.doc.nodeAt(after);
            if (next?.type.name === 'paragraph' && next.content.size === 0) {
              // An empty paragraph already follows the callout (typically
              // StarterKit's trailing node at the end of the doc) — exit
              // into it instead of inserting a second one.
              editor
                .chain()
                .focus()
                .deleteRange({ from: $from.before($from.depth), to: $from.after($from.depth) })
                .setTextSelection(exitPos)
                .run();
              return true;
            }
            // Insert BEFORE deleting: every chained step resolves raw
            // positions against the transaction's CURRENT doc, so doing the
            // delete first left `after` stale (the new paragraph landed 2
            // positions too far, splitting the block after the callout).
            // Inserting first keeps the delete range untouched (it precedes
            // the insertion point) and also guarantees the callout has a
            // following sibling when the delete runs — deleting a trailing
            // paragraph at the very end of the doc makes ProseMirror's
            // replace fitter lift it out of the callout instead of removing
            // it.
            editor
              .chain()
              .focus()
              .insertContentAt(after, { type: 'paragraph' })
              .deleteRange({ from: $from.before($from.depth), to: $from.after($from.depth) })
              .setTextSelection(exitPos)
              .run();
            return true;
          }
          return false;
        }
        return false;
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        // tiptap-markdown serializer state types aren't exported.
        serialize(state: unknown, node: unknown) {
          interface MdState {
            write: (s: string) => void;
            closeBlock: (n: unknown) => void;
            renderContent: (n: unknown) => void;
          }
          const writer = state as MdState;
          const n = node as { attrs: { emoji?: string; variant?: string; bg?: string | null } };
          const emoji = n.attrs.emoji || '💡';
          const variant = n.attrs.variant || 'info';
          const bgAttr = n.attrs.bg ? ` data-bg="${n.attrs.bg}"` : '';
          writer.write(
            `<div data-callout data-variant="${variant}" data-emoji="${emoji}"${bgAttr}>\n\n`,
          );
          writer.renderContent(node);
          writer.write('\n</div>');
          writer.closeBlock(node);
        },
      },
    };
  },
});
