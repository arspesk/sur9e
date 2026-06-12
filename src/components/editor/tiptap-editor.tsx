'use client';

// TipTap-backed markdown editor — React adapter for /profile.
// Verbatim port of public/tiptap-editor.js to @tiptap/react: the editor
// is constructed via useEditor() inside this React component instead of
// imperatively, but the extension list, slash-menu items, block-menu
// items, link popover, and DOM class names match the legacy bundle
// character-for-character.
//
// Notion-feel comes from official TipTap extensions:
//  - DragHandle  — left-gutter handle that appears next to any block on
//                  hover. We render BOTH a "+" (insert) button and a
//                  "⠿" (drag/options) button inside it, like Notion.
//  - BubbleMenu  — formatting toolbar on text selection.
//  - Suggestion  — slash command popup ('/').
//
// The link popover, block-options menu, and the slash-menu picker for
// the "+" button are bespoke (TipTap doesn't ship those out of the box).

import { type Editor as TiptapEditor } from '@tiptap/core';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import CharacterCount from '@tiptap/extension-character-count';
import { Color } from '@tiptap/extension-color';
import { DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import DragHandle from '@tiptap/extension-drag-handle';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { useEffect, useImperativeHandle, useRef } from 'react';
import { Markdown } from 'tiptap-markdown';
import { makeBubbleColorButton } from './bubble-color-popover';
import { type CalloutPopoverHandle, mountCalloutPopover } from './callout-popover';
import { CalloutNode } from './extensions/callout-node';
import { CodeBlockWithChrome } from './extensions/code-block-view';
import { DetailsBlock } from './extensions/details-block';
import { FitColorizer } from './extensions/fit-colorizer';
import { HeadingId } from './extensions/heading-id';
import { RunningMode } from './extensions/running-mode-node';
import { SnapshotNode } from './extensions/snapshot-node';
import { StableImage } from './extensions/stable-image';
import { uploadAndInsertImages } from './image-upload';
import { registerBasicSlashItems } from './slash-items-basic';
import type { SlashContext, SlashItem } from './slash-registry';
import { mountTableHoverMenus, type TableHoverHandle } from './table-hover-menus';
import { type BlockMenuHandle, mountBlockMenu } from './tiptap-block-menu';
import { makeIcon } from './tiptap-icons';
import { type LinkPopoverHandle, mountLinkPopover } from './tiptap-link-popover';
import { SlashCommand } from './tiptap-slash';

const lowlight = createLowlight(common);
// `text` / `plaintext` must render with NO syntax highlighting. They aren't in
// the `common` grammar set, so without this CodeBlockLowlight falls back to
// highlightAuto() and colors random words (the "text block is still
// highlighted" bug). Register them as no-op grammars — empty rules, autodetect
// off — so a `text` block stays plain.
const plaintextGrammar = () => ({ name: 'plaintext', disableAutodetect: true, contains: [] });
lowlight.register({ text: plaintextGrammar, plaintext: plaintextGrammar, txt: plaintextGrammar });

export interface TipTapEditorHandle {
  editor: TiptapEditor | null;
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  focus: () => void;
}

interface TipTapEditorProps {
  name: string;
  defaultValue?: string;
  ariaLabel?: string;
  placeholder?: string;
  onChange?: (md: string) => void;
  handleRef?: React.RefObject<TipTapEditorHandle | null>;
  slashItems?: SlashItem[];
  slashContext?: SlashContext;
}

function makeIconBtn(iconName: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'be-mb__btn';
  b.appendChild(makeIcon(iconName));
  b.setAttribute('aria-label', title);
  b.title = title;
  b.addEventListener('mousedown', e => {
    e.preventDefault();
    onClick();
  });
  return b;
}

function renderBubbleMenu(root: HTMLElement, editor: TiptapEditor, linkPopover: LinkPopoverHandle) {
  root.replaceChildren();
  const chain = () => editor.chain().focus();
  root.appendChild(makeIconBtn('bold', 'Bold (⌘B)', () => chain().toggleBold().run()));
  root.appendChild(makeIconBtn('italic', 'Italic (⌘I)', () => chain().toggleItalic().run()));
  root.appendChild(
    makeIconBtn('underline', 'Underline (⌘U)', () => chain().toggleUnderline().run()),
  );
  root.appendChild(makeIconBtn('strike', 'Strikethrough', () => chain().toggleStrike().run()));
  // Text + highlight color for the current SELECTION (per-text-piece coloring
  // in the focus menu). Block-level color also lives in the :: menu's "Color"
  // submenu — bubble = selection scope, :: = whole block.
  root.appendChild(makeBubbleColorButton(editor));
  root.appendChild(makeIconBtn('code', 'Inline code', () => chain().toggleCode().run()));
  // H1/H2 toggles removed from the focus menu — heading changes live in the
  // slash menu and the `::` block menu's "Turn into" submenu instead.
  root.appendChild(makeIconBtn('link', 'Link', () => linkPopover.open()));
}

// DragHandle render: a single gutter element holding "+" and "⠿" so both
// affordances live next to the hovered block (Notion). The "+" is a
// small button inside; the parent acts as the drag source.
function makeDragHandleEl(opts: {
  onPlusClick: () => void;
  onGripClick: (rect: DOMRect) => void;
}): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'be-handle';
  // Only ONE gutter affordance shows at a time (Notion-style): the "+" on an
  // empty block, the "⠿" grip on a block with content. onNodeChange flips
  // data-block-mode; CSS shows the matching button. Default to grip.
  root.dataset.blockMode = 'text';

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'be-handle__btn be-handle__plus';
  plus.appendChild(makeIcon('plus'));
  plus.setAttribute('aria-label', 'Insert block below');
  plus.title = 'Click to add a block below';
  plus.addEventListener('mousedown', e => {
    // Stop the drag from starting and the click from bubbling so
    // DragHandle's pointerdown listener doesn't kick in.
    e.preventDefault();
    e.stopPropagation();
  });
  plus.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    opts.onPlusClick();
  });

  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'be-handle__btn be-handle__grip';
  grip.appendChild(makeIcon('grip'));
  grip.setAttribute('aria-label', 'Drag to move, click for options');
  grip.title = 'Drag to move · click for options';
  // We INTENTIONALLY don't preventDefault on grip's mousedown so the
  // DragHandle plugin can capture pointerdown for native drag.
  grip.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    opts.onGripClick(grip.getBoundingClientRect());
  });

  root.appendChild(plus);
  root.appendChild(grip);
  return root;
}

function buildExtensions(placeholder?: string, slashContext?: SlashContext) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      // Disabled in favor of CodeBlockLowlight below.
      codeBlock: false,
      horizontalRule: { HTMLAttributes: { class: 'be-hr' } },
      // Disable the bundled link in favor of the standalone extension so
      // we can pass our own attributes + autolink/openOnClick.
      link: false,
    }),
    Link.configure({
      // autolink:false — preserve the user's source as-is. We don't
      // want plain "user@host" silently rewritten to a markdown link
      // on first save. linkOnPaste still applies for pasted URLs.
      openOnClick: false,
      autolink: false,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    TaskList.configure({ HTMLAttributes: { class: 'be-todo' } }),
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true, HTMLAttributes: { class: 'be-table' } }),
    TableRow,
    TableHeader,
    TableCell,
    StableImage.configure({ HTMLAttributes: { class: 'be-image' } }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    CharacterCount.configure({ limit: 50000 }),
    CodeBlockWithChrome.configure({
      lowlight,
      // Blocks with no explicit language default to `text` (no highlighting)
      // rather than triggering highlightAuto() and coloring plain prose.
      defaultLanguage: 'text',
      HTMLAttributes: { class: 'be-codeblock' },
    }),
    FitColorizer,
    HeadingId,
    // Notion-style toggle (heading / list / plain) on the official Details
    // engine. persist:true so the open/closed state round-trips in markdown.
    // A real SVG chevron in the toggle button (CSS rotates it when open).
    DetailsBlock.configure({
      persist: true,
      HTMLAttributes: { class: 'be-details' },
      renderToggleButton: ({ element, isOpen }: { element: HTMLElement; isOpen: boolean }) => {
        element.classList.add('be-details__toggle');
        element.setAttribute('aria-label', isOpen ? 'Collapse' : 'Expand');
        element.replaceChildren(makeIcon('chevronRight'));
      },
    }),
    DetailsSummary,
    DetailsContent,
    RunningMode,
    SnapshotNode,
    CalloutNode,
    Placeholder.configure({
      // Suppress the prose placeholder inside code blocks — an empty code block
      // should read as empty code, not show "Type '/' for commands…" (which also
      // can't be acted on there). Every other empty block keeps the hint.
      placeholder: ({ node }: { node: PMNode }) =>
        node.type.name === 'codeBlock'
          ? ''
          : placeholder || "Type '/' for commands or just start writing…",
      includeChildren: false,
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
    }),
    SlashCommand.configure({ context: slashContext ?? {} }),
    // Markdown extension MUST be last (per tiptap-markdown docs) so its
    // serializer sees the final extension list.
    Markdown.configure({
      html: true,
      tightLists: true,
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}

export function TipTapEditor({
  name,
  defaultValue = '',
  ariaLabel,
  placeholder,
  onChange,
  handleRef,
  slashContext,
}: TipTapEditorProps) {
  // Idempotent — guards against StrictMode + HMR double-invoke.
  useEffect(() => {
    registerBasicSlashItems();
  }, []);

  // Track the hovered node so the gutter buttons know which block they act
  // on. Stored in refs because the DragHandle callbacks and the block-menu
  // handlers read them outside of React's render cycle.
  const currentNodeRef = useRef<PMNode | null>(null);
  const currentPosRef = useRef<number>(-1);
  // The live DragHandle gutter element — captured on each render() so
  // onNodeChange can toggle which affordance (+ vs ⠿) is visible (bug 8).
  const dragHandleElRef = useRef<HTMLDivElement | null>(null);

  // BubbleMenu element MUST exist synchronously before useEditor is called —
  // the extension reads `element` at config-build time, so a useEffect-created
  // element arrives too late and the menu silently no-ops. Create lazily on
  // first client render via a ref initializer, append/remove in a useEffect.
  const bubbleElRef = useRef<HTMLDivElement | null>(null);
  if (typeof document !== 'undefined' && bubbleElRef.current === null) {
    const el = document.createElement('div');
    el.className = 'be-bubble';
    el.style.cssText = 'position:absolute;top:0;left:0;visibility:hidden;';
    bubbleElRef.current = el;
  }

  const blockMenuRef = useRef<BlockMenuHandle | null>(null);
  const tableHoverRef = useRef<TableHoverHandle | null>(null);
  const linkPopoverRef = useRef<LinkPopoverHandle | null>(null);
  const calloutPopoverRef = useRef<CalloutPopoverHandle | null>(null);
  const mountedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  // editorRef holds the current editor instance so DragHandle's onPlusClick
  // callback (which captures `editor` in a closure at useEditor config time —
  // when `editor` is still null because immediatelyRender:false) can read the
  // live value at click time. Without this the + button is unreachable: the
  // closure's `const ed = editor` evaluates to null and the handler returns.
  const editorRef = useRef<TiptapEditor | null>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Append/remove the bubble element from the document body. The element
  // itself was already created above via the ref initializer.
  useEffect(() => {
    const el = bubbleElRef.current;
    if (!el) return;
    document.body.appendChild(el);
    return () => {
      el.remove();
    };
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...buildExtensions(placeholder, slashContext),
      DragHandle.configure({
        render: () => {
          const el = makeDragHandleEl({
            onPlusClick: () => {
              // The "+" only shows on an EMPTY block (bug 8), so drop the
              // slash on THAT line rather than inserting a new paragraph
              // below — otherwise we'd strand a blank line above the menu.
              // Read editor via ref — closure capture of `editor` is null at
              // config time (immediatelyRender:false).
              const ed = editorRef.current;
              if (!ed) return;
              const pos = currentPosRef.current;
              if (pos < 0) {
                ed.chain().focus().insertContent('/').run();
                return;
              }
              ed.chain()
                .focus()
                .setTextSelection(pos + 1)
                .insertContent('/')
                .run();
            },
            onGripClick: rect => blockMenuRef.current?.open(rect),
          });
          dragHandleElRef.current = el;
          return el;
        },
        // The underlying plugin passes { editor, node, pos }; the typed
        // option signature in @tiptap/extension-drag-handle only declares
        // node + editor, so cast the callback to read pos.
        onNodeChange: ({ node, ...rest }: { node: PMNode | null; editor: TiptapEditor }) => {
          currentNodeRef.current = node;
          const maybePos = (rest as unknown as { pos?: number }).pos;
          currentPosRef.current = typeof maybePos === 'number' ? maybePos : -1;
          // Show "+" on an empty text block, "⠿" grip otherwise.
          const handle = dragHandleElRef.current;
          if (handle) {
            const isEmptyTextblock = !!node && node.isTextblock && node.content.size === 0;
            handle.dataset.blockMode = isEmptyTextblock ? 'empty' : 'text';
          }
        },
      }),
      BubbleMenu.configure({
        // The text-formatting bubble — table actions moved out to the
        // hover-grip menus (see mountTableHoverMenus below) so the table
        // gets a quiet chrome until the user reaches for it.
        pluginKey: 'textBubbleMenu',
        element: bubbleElRef.current,
        shouldShow: ({ editor: ed, from, to }) => {
          if (from === to) return false; // empty selection
          if (ed.isActive('codeBlock')) return false;
          return true;
        },
      }),
    ],
    content: defaultValue || '',
    autofocus: false,
    editable: true,
    editorProps: {
      attributes: {
        class: 'be-prose',
        'data-md-name': name || '',
        spellcheck: 'true',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      // Drag-and-drop images: intercept before ProseMirror's default drop
      // (which would insert the OS-native file path as text). Upload via
      // /api/output/inline and insert <img> nodes at the drop position.
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        const images = files.filter(f => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        const coords = view.posAtCoords({
          left: (event as DragEvent).clientX,
          top: (event as DragEvent).clientY,
        });
        const pos = coords?.pos ?? view.state.selection.from;
        const ed = editorRef.current;
        if (ed) void uploadAndInsertImages(ed, images, pos);
        return true;
      },
      // Clipboard paste: same idea — if the paste contains image files,
      // upload + insert at the caret. Text/HTML pastes fall through to
      // ProseMirror's default handler.
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        const images = files.filter(f => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        const ed = editorRef.current;
        if (ed) void uploadAndInsertImages(ed, images, view.state.selection.from);
        return true;
      },
      // Links open on a plain left-click (openOnClick stays false on the Link
      // extension so we own this — avoids a double-open). To edit a link,
      // select its text and use the bubble-menu link popover. We only act on a
      // primary-button click on an actual anchor; everything else falls through
      // to ProseMirror's normal cursor placement.
      handleClick(_view, _pos, event) {
        const me = event as MouseEvent;
        if (me.button !== 0) return false;
        const anchor = (me.target as HTMLElement | null)?.closest(
          'a[href]',
        ) as HTMLAnchorElement | null;
        const href = anchor?.getAttribute('href');
        if (!href) return false;
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (!mountedRef.current) return;
      const cb = onChangeRef.current;
      if (typeof cb !== 'function') return;
      try {
        const storage = ed.storage as { markdown?: { getMarkdown(): string } };
        const md = storage.markdown?.getMarkdown() ?? '';
        cb(md);
      } catch (err) {
        console.error('[tiptap] getMarkdown failed:', err);
      }
    },
  });

  // Keep editorRef in sync — the DragHandle's onPlusClick callback reads
  // editorRef.current to bypass closure-capture staleness.
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Broken images (failed loads — e.g. pasted Notion icons whose URLs 404 here)
  // have an indeterminate intrinsic size that the browser flickers between 0×0
  // and a placeholder box during the repaints typing triggers. That reflow
  // jumps every line below them on each keystroke. Tag failed images so CSS can
  // pin them to a stable placeholder box. `error` doesn't bubble, so the
  // listener runs in the capture phase.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const onError = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLImageElement) t.classList.add('be-image--broken');
    };
    const onLoad = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLImageElement && t.naturalWidth > 0)
        t.classList.remove('be-image--broken');
    };
    dom.addEventListener('error', onError, true);
    dom.addEventListener('load', onLoad, true);
    // Catch images that already failed before this listener attached (content
    // loads async via setContent, so sweep now and once more after paint).
    const sweep = () => {
      for (const img of dom.querySelectorAll('img')) {
        if (img.complete && img.naturalWidth === 0) img.classList.add('be-image--broken');
      }
    };
    sweep();
    const t = setTimeout(sweep, 600);
    return () => {
      dom.removeEventListener('error', onError, true);
      dom.removeEventListener('load', onLoad, true);
      clearTimeout(t);
    };
  }, [editor]);

  // Sync defaultValue → editor when the markdown loads asynchronously
  // (the legacy form calls `loadMd` then `mount`; in React we mount the
  // editor immediately and feed it the body once the fetch resolves).
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage as { markdown?: { getMarkdown(): string } };
    const current = storage.markdown?.getMarkdown() ?? '';
    if (defaultValue !== current) {
      // setContent with false flag suppresses onUpdate so we don't loop.
      editor.commands.setContent(defaultValue || '', { emitUpdate: false });
    }
  }, [editor, defaultValue]);

  useEffect(() => {
    if (!editor) return;
    const bubbleEl = bubbleElRef.current;
    if (!bubbleEl) return;

    linkPopoverRef.current = mountLinkPopover(editor);
    blockMenuRef.current = mountBlockMenu(
      editor,
      () => ({
        node: currentNodeRef.current,
        pos: currentPosRef.current,
      }),
      {
        // "Edit icon" row (callouts only) → open the shared emoji picker.
        // Read the ref lazily so mount order within this effect doesn't matter.
        openEmojiPicker: (pos, rect) => calloutPopoverRef.current?.openForPos(pos, rect),
      },
    );

    renderBubbleMenu(bubbleEl, editor, linkPopoverRef.current);

    // Table actions live in two hover-grip dropdowns (column + row).
    // The grips appear next to the hovered cell; clicking opens a
    // vertical .be-bm menu scoped to that axis.
    const editorEl = editor.view.dom.closest('.report-body') as HTMLElement | null;
    if (editorEl) {
      tableHoverRef.current = mountTableHoverMenus(editor, editorEl);
    }
    // Callout emoji click → popover to swap emoji + variant color.
    // Falls back to the prose element when the report-body host isn't
    // present (e.g. profile/settings editors).
    const calloutHost =
      (editor.view.dom.closest('.report-body') as HTMLElement | null) ??
      (editor.view.dom.closest('.be-prose') as HTMLElement | null) ??
      editor.view.dom;
    calloutPopoverRef.current = mountCalloutPopover(editor, calloutHost as HTMLElement);

    // Match legacy `Promise.resolve().then(() => mounted = true)` —
    // suppress the synthetic initial setContent transaction's onUpdate.
    Promise.resolve().then(() => {
      mountedRef.current = true;
    });

    return () => {
      mountedRef.current = false;
      linkPopoverRef.current?.destroy();
      blockMenuRef.current?.destroy();
      tableHoverRef.current?.destroy();
      calloutPopoverRef.current?.destroy();
      linkPopoverRef.current = null;
      blockMenuRef.current = null;
      tableHoverRef.current = null;
      calloutPopoverRef.current = null;
    };
  }, [editor]);

  // Imperative handle — exposes the same surface as legacy BlockEditor.
  useImperativeHandle(
    handleRef,
    (): TipTapEditorHandle => ({
      editor: editor ?? null,
      getMarkdown: () => {
        if (!editor) return '';
        const storage = editor.storage as { markdown?: { getMarkdown(): string } };
        return storage.markdown?.getMarkdown() ?? '';
      },
      setMarkdown: md => editor?.commands.setContent(md || '', { emitUpdate: false }),
      focus: () => editor?.commands.focus('end'),
    }),
    [editor],
  );

  return <EditorContent editor={editor} />;
}
