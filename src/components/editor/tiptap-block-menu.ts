// Notion-style block-options menu (drag-handle click). Layout mirrors
// the Tiptap notion-like template:
//
//   <Block-type label>
//   ─ Turn Into ▸
//   ─ Reset formatting
//   ──
//   ─ Duplicate                     ⌘D
//   ─ Copy to clipboard             ⌘C
//   ──
//   ─ Delete                       (Del, danger)
//
// Items show an icon on the left + label + optional shortcut on the right.
//
// Verbatim port of public/tiptap-block-menu.js.

import type { Editor as TiptapEditor } from '@tiptap/core';
// Side-effect import: registers setImage on the chain command surface so the
// Image entry in Turn Into compiles with full type safety. Mirrors the
// import in slash-items-basic.ts where the same command is wired up.
import '@tiptap/extension-image';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { BG_COLORS, type ColorSwatch, TEXT_COLORS } from './editor-colors';
import { applyToggle } from './extensions/details-block';
import { uploadAndInsertImages } from './image-upload';
import { makeIcon } from './tiptap-icons';

interface TurnIntoItem {
  label: string;
  iconName: string;
  cmd: (ed: TiptapEditor) => void;
}

// Place the caret on the first valid text position INSIDE the node at `pos`.
// A blind `setTextSelection(pos + 1)` THROWS for wrapper nodes (blockquote,
// details, lists): pos+1 is a node boundary with no inline content
// ("TextSelection endpoint not pointing into a node with inline content"),
// which silently killed every Turn-into action on quoted blocks.
// TextSelection.near walks forward to the nearest valid caret instead.
function selectInside(editor: TiptapEditor, pos: number): void {
  const { state, view } = editor;
  const $pos = state.doc.resolve(Math.min(pos + 1, state.doc.content.size));
  view.dispatch(state.tr.setSelection(TextSelection.near($pos, 1)).scrollIntoView());
  view.focus();
}

// Select the FULL inline content of the node at `pos` (size `nodeSize`),
// snapping both endpoints to valid text positions — same boundary hazard
// as selectInside, hit by the Color submenu on wrapper nodes.
function selectNodeContent(editor: TiptapEditor, pos: number, nodeSize: number): void {
  const { state, view } = editor;
  const max = state.doc.content.size;
  const $from = state.doc.resolve(Math.min(pos + 1, max));
  const $to = state.doc.resolve(Math.min(pos + nodeSize - 1, max));
  view.dispatch(state.tr.setSelection(TextSelection.between($from, $to)));
  view.focus();
}

// File-picker helper for the Image entry. Delegates the upload + insert to
// uploadAndInsertImages so the slash menu, drag-drop, paste, and block
// menu surfaces all use the same code path.
function pickAndInsertImage(ed: TiptapEditor): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    void uploadAndInsertImages(ed, files, ed.state.selection.from);
  };
  input.click();
}

// Order matches the slash menu's BASIC array (see slash-items-basic.ts) so
// the two surfaces stay in lockstep.
const TURN_INTO: TurnIntoItem[] = [
  {
    label: 'Heading 1',
    iconName: 'h1',
    cmd: ed => ed.chain().focus().clearNodes().setHeading({ level: 1 }).run(),
  },
  {
    label: 'Heading 2',
    iconName: 'h2',
    cmd: ed => ed.chain().focus().clearNodes().setHeading({ level: 2 }).run(),
  },
  {
    label: 'Heading 3',
    iconName: 'h3',
    cmd: ed => ed.chain().focus().clearNodes().setHeading({ level: 3 }).run(),
  },
  {
    label: 'Heading 4',
    iconName: 'h4',
    cmd: ed => ed.chain().focus().clearNodes().setHeading({ level: 4 }).run(),
  },
  ...([1, 2, 3] as const).map(level => ({
    label: `Toggle heading ${level}`,
    iconName: `toggleH${level}` as const,
    cmd: (ed: TiptapEditor) => {
      applyToggle(ed, 'heading', level);
    },
  })),
  {
    label: 'Toggle list',
    iconName: 'toggleList',
    cmd: (ed: TiptapEditor) => {
      applyToggle(ed, 'list');
    },
  },
  {
    label: 'Paragraph',
    iconName: 'paragraph',
    cmd: ed => ed.chain().focus().clearNodes().setParagraph().run(),
  },
  {
    label: 'Bullet list',
    iconName: 'list',
    cmd: ed => ed.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered list',
    iconName: 'listOrdered',
    cmd: ed => ed.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'To-do list',
    iconName: 'listChecks',
    cmd: ed => ed.chain().focus().toggleTaskList().run(),
  },
  { label: 'Quote', iconName: 'quote', cmd: ed => ed.chain().focus().setBlockquote().run() },
  {
    label: 'Callout',
    iconName: 'callout',
    cmd: ed =>
      ed
        .chain()
        .focus()
        .insertContent({
          type: 'callout',
          attrs: { variant: 'info', emoji: '💡' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    label: 'Divider',
    iconName: 'minus',
    cmd: ed => ed.chain().focus().setHorizontalRule().run(),
  },
  {
    label: 'Code block',
    iconName: 'squareCode',
    cmd: ed => ed.chain().focus().setCodeBlock().run(),
  },
  {
    label: 'Table',
    iconName: 'table',
    cmd: ed => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { label: 'Image', iconName: 'image', cmd: pickAndInsertImage },
];

const NODE_LABELS: Record<string, string> = {
  paragraph: 'Text',
  heading: 'Heading',
  bulletList: 'Bullet list',
  orderedList: 'Numbered list',
  taskList: 'To-do list',
  blockquote: 'Quote',
  codeBlock: 'Code block',
  horizontalRule: 'Divider',
  table: 'Table',
};

function nodeLabel(node: PMNode | null): string {
  if (!node) return 'Block';
  const name = node.type.name;
  if (name === 'heading') {
    const lvl = (node.attrs as { level?: number })?.level || 1;
    return `Heading ${lvl}`;
  }
  return NODE_LABELS[name] || name;
}

interface RowOpts {
  icon?: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
  // Submenu rows (Turn into, Color) get a subtle chevron `›` on the right —
  // the Notion affordance. We no longer render keyboard-shortcut helpers in
  // the menu: the shortcuts weren't wired up, so they only misled the user.
  hasArrow?: boolean;
}

function row({ icon, label, danger, onClick, hasArrow }: RowOpts): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `be-bm__item${danger ? ' is-danger' : ''}`;
  btn.setAttribute('role', 'menuitem');

  const iconWrap = document.createElement('span');
  iconWrap.className = 'be-bm__icon';
  if (icon) {
    iconWrap.appendChild(makeIcon(icon));
  }
  btn.appendChild(iconWrap);

  const lbl = document.createElement('span');
  lbl.className = 'be-bm__label';
  lbl.textContent = label;
  btn.appendChild(lbl);

  if (hasArrow) {
    const arrow = document.createElement('span');
    arrow.className = 'be-bm__arrow';
    arrow.appendChild(makeIcon('chevronRight'));
    btn.appendChild(arrow);
  }

  btn.addEventListener('mousedown', e => {
    e.preventDefault();
    onClick();
  });
  return btn;
}

// Color-swatch row for the Color submenu — an "A" glyph tinted with the text
// color, or a filled chip for the background color. Built without makeIcon
// because the icon here is a dynamic color sample, not a static SVG.
function colorRow(kind: 'text' | 'bg', c: ColorSwatch, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'be-bm__item';
  btn.setAttribute('role', 'menuitem');

  const iconWrap = document.createElement('span');
  iconWrap.className = 'be-bm__icon be-bm__coloricon';
  if (kind === 'text') {
    iconWrap.textContent = 'A';
    if (c.value) iconWrap.style.color = c.value;
  } else {
    iconWrap.classList.add('be-bm__coloricon--bg');
    if (c.value) iconWrap.style.background = c.value;
  }
  btn.appendChild(iconWrap);

  const lbl = document.createElement('span');
  lbl.className = 'be-bm__label';
  lbl.textContent =
    c.value === ''
      ? kind === 'text'
        ? 'Default text'
        : 'Default background'
      : `${c.name} ${kind === 'text' ? 'text' : 'background'}`;
  btn.appendChild(lbl);

  btn.addEventListener('mousedown', e => {
    e.preventDefault();
    onClick();
  });
  return btn;
}

function sep(): HTMLDivElement {
  const s = document.createElement('div');
  s.className = 'be-bm__sep';
  return s;
}

function header(text: string): HTMLDivElement {
  const h = document.createElement('div');
  h.className = 'be-bm__head';
  h.textContent = text;
  return h;
}

export interface BlockMenuHandle {
  open: (anchorRect: DOMRect) => void;
  close: () => void;
  destroy: () => void;
}

export interface BlockMenuOpts {
  // Opens the callout emoji picker for the callout at `pos` (wired from
  // tiptap-editor.tsx to the shared callout popover). Only invoked for the
  // "Edit icon" row, which is rendered only when the current block is a callout.
  openEmojiPicker?: (pos: number, anchorRect: DOMRect) => void;
}

export function mountBlockMenu(
  editor: TiptapEditor,
  getCurrent: () => { node: PMNode | null; pos: number },
  opts: BlockMenuOpts = {},
): BlockMenuHandle {
  let menu: HTMLDivElement | null = null;
  let submenu: HTMLDivElement | null = null; // shared by Turn into + Color
  // Timestamp of the last open() — scroll/blur closers ignore events within
  // a short grace window so the same gesture that opened the menu (the grip
  // click, which blurs contentEditable + can emit a scroll as the DragHandle
  // re-renders) doesn't close it the instant it appears.
  let openedAt = 0;
  const GRACE_MS = 250;

  function close() {
    if (menu) menu.style.display = 'none';
    if (submenu) submenu.style.display = 'none';
  }

  function isOpen() {
    return !!menu && menu.style.display === 'flex';
  }

  function buildSubmenu(): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'be-bm';
    root.setAttribute('role', 'menu');
    document.body.appendChild(root);
    return root;
  }

  // Position the (already-populated, display:flex) submenu next to its parent
  // row — to the right by default, flipping left/up when it would overflow.
  function placeSubmenu(anchorRect: DOMRect) {
    if (!submenu) return;
    const sm = submenu.getBoundingClientRect();
    let top = anchorRect.top;
    let left = anchorRect.right + 4;
    if (left + sm.width > window.innerWidth - 8) {
      left = anchorRect.left - sm.width - 4;
    }
    if (top + sm.height > window.innerHeight - 8) {
      top = window.innerHeight - sm.height - 8;
    }
    submenu.style.top = `${Math.max(8, top)}px`;
    submenu.style.left = `${Math.max(8, left)}px`;
  }

  function openTurnInto(anchorRect: DOMRect, capturedPos: number) {
    if (!submenu) submenu = buildSubmenu();
    submenu.replaceChildren();
    submenu.appendChild(header('Turn into'));
    for (const t of TURN_INTO) {
      submenu.appendChild(
        row({
          icon: t.iconName,
          label: t.label,
          onClick: () => {
            // Use the position captured when the parent menu opened —
            // currentPos may be -1 by now because the cursor has left
            // the editor and DragHandle.onNodeChange reset it.
            if (capturedPos < 0) return;
            selectInside(editor, capturedPos);
            t.cmd(editor);
            close();
          },
        }),
      );
    }
    submenu.style.display = 'flex';
    placeSubmenu(anchorRect);
  }

  // Color submenu — Notion-style text-color list + background-color list.
  // Text colors recolor the block's text; background colors recolor the
  // whole callout when the current block IS a callout, otherwise they
  // highlight the block's text. Applies to the block captured when the
  // parent menu opened (capturedPos), regardless of where the caret is now.
  function openColorMenu(anchorRect: DOMRect, capturedPos: number, node: PMNode | null) {
    if (!submenu) submenu = buildSubmenu();
    submenu.replaceChildren();
    const isCallout = node?.type.name === 'callout';
    // Full content range of the captured block, so colors apply to ALL the
    // block's text even though the grip click left the selection collapsed.
    // selectNodeContent snaps both endpoints — a raw {pos+1, pos+nodeSize-1}
    // TextSelection throws on wrapper nodes (blockquote/details).
    const selectBlock = () => {
      selectNodeContent(editor, capturedPos, node ? node.nodeSize : 2);
      return editor.chain();
    };

    submenu.appendChild(header('Text color'));
    for (const c of TEXT_COLORS) {
      submenu.appendChild(
        colorRow('text', c, () => {
          if (capturedPos < 0) return;
          if (c.value === '') selectBlock().unsetColor().run();
          else selectBlock().setColor(c.value).run();
          close();
        }),
      );
    }

    submenu.appendChild(header('Background color'));
    for (const c of BG_COLORS) {
      submenu.appendChild(
        colorRow('bg', c, () => {
          if (capturedPos < 0) return;
          if (isCallout) {
            // Recolor the whole callout via its `bg` attr instead of
            // highlighting text — the behavior the user asked for.
            const cur = editor.state.doc.nodeAt(capturedPos);
            if (cur && cur.type.name === 'callout') {
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(capturedPos, undefined, {
                  ...cur.attrs,
                  bg: c.value || null,
                }),
              );
            }
          } else if (c.value === '') {
            selectBlock().unsetHighlight().run();
          } else {
            selectBlock().setHighlight({ color: c.value }).run();
          }
          close();
        }),
      );
    }

    submenu.style.display = 'flex';
    placeSubmenu(anchorRect);
  }

  function open(anchorRect: DOMRect) {
    if (!menu) menu = buildSubmenu();
    menu.replaceChildren();
    openedAt = Date.now();

    const cur = getCurrent();
    if (!cur || cur.pos < 0) return;
    const { pos, node } = cur;
    if (!node) return;

    menu.appendChild(header(nodeLabel(node)));

    const turnIntoBtn = row({
      icon: 'turnInto',
      label: 'Turn into',
      hasArrow: true,
      onClick: () => openTurnInto(turnIntoBtn.getBoundingClientRect(), pos),
    });
    menu.appendChild(turnIntoBtn);

    const colorBtn = row({
      icon: 'palette',
      label: 'Color',
      hasArrow: true,
      onClick: () => openColorMenu(colorBtn.getBoundingClientRect(), pos, node),
    });
    menu.appendChild(colorBtn);

    // Callout-only: swap the emoji via the shared emoji picker.
    if (node.type.name === 'callout' && opts.openEmojiPicker) {
      const editIconBtn = row({
        icon: 'smile',
        label: 'Edit icon',
        onClick: () => {
          opts.openEmojiPicker?.(pos, editIconBtn.getBoundingClientRect());
          close();
        },
      });
      menu.appendChild(editIconBtn);
    }

    menu.appendChild(
      row({
        icon: 'removeFormatting',
        label: 'Reset formatting',
        onClick: () => {
          selectInside(editor, pos);
          editor.chain().focus().clearNodes().unsetAllMarks().run();
          close();
        },
      }),
    );
    menu.appendChild(sep());

    menu.appendChild(
      row({
        icon: 'copy',
        label: 'Duplicate',
        onClick: () => {
          const json = node.toJSON();
          editor
            .chain()
            .focus()
            .insertContentAt(pos + node.nodeSize, json)
            .run();
          close();
        },
      }),
    );
    menu.appendChild(
      row({
        icon: 'clipboard',
        label: 'Copy to clipboard',
        onClick: async () => {
          try {
            const md = node.textContent || '';
            await navigator.clipboard.writeText(md);
          } catch {
            /* clipboard blocked */
          }
          close();
        },
      }),
    );
    menu.appendChild(sep());

    menu.appendChild(
      row({
        icon: 'trash',
        label: 'Delete',
        danger: true,
        onClick: () => {
          editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
          close();
        },
      }),
    );

    menu.style.display = 'flex';
    const m = menu.getBoundingClientRect();
    let top = anchorRect.bottom + 4;
    let left = anchorRect.left;
    if (top + m.height > window.innerHeight - 8) {
      top = anchorRect.top - m.height - 4;
    }
    if (left + m.width > window.innerWidth - 8) {
      left = window.innerWidth - m.width - 8;
    }
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${Math.max(8, left)}px`;
  }

  function onDocClick(e: MouseEvent) {
    if (!menu || menu.style.display !== 'flex') return;
    if (menu.contains(e.target as Node)) return;
    if (submenu && submenu.contains(e.target as Node)) return;
    close();
  }
  document.addEventListener('mousedown', onDocClick, true);

  // Close on window resize (layout shift).
  function onResize() {
    close();
  }
  window.addEventListener('resize', onResize);

  // Close on page scroll. Listen on `window` in the BUBBLE phase (NOT
  // capture) so the editor's internal scroll containers — which fire scroll
  // events when the DragHandle re-renders during mousemove — don't reach us
  // (scroll doesn't bubble, so window only sees document-level scrolls). The
  // grace window is a second guard against the open-then-instantly-close bug.
  function onScroll() {
    if (!isOpen()) return;
    if (Date.now() - openedAt < GRACE_MS) return;
    close();
  }
  window.addEventListener('scroll', onScroll);

  // Close when focus leaves the editor (e.g. the user clicks elsewhere on the
  // page). Scoped to the editor DOM via focusout. Ignore focus moving INTO the
  // menu/submenu (clicking an item) and apply the same grace window — the grip
  // click that opens the menu blurs the contentEditable, which would otherwise
  // fire focusout and close the menu immediately.
  function onFocusOut(e: FocusEvent) {
    if (!isOpen()) return;
    if (Date.now() - openedAt < GRACE_MS) return;
    const next = e.relatedTarget as Node | null;
    if (next && (menu?.contains(next) || submenu?.contains(next))) return;
    close();
  }
  editor.view.dom.addEventListener('focusout', onFocusOut);

  return {
    open,
    close,
    destroy() {
      document.removeEventListener('mousedown', onDocClick, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      editor.view.dom.removeEventListener('focusout', onFocusOut);
      if (menu) menu.remove();
      if (submenu) submenu.remove();
    },
  };
}
