// TipTap Suggestion extension that drives the cmdk slash menu via tippy.js.
// All menu items come from slash-registry.ts.
//
// Keyboard handling: TipTap's Suggestion plugin owns key events while the
// popup is open (ProseMirror would otherwise eat them as normal editing
// input). We track the active index in this closure, intercept Arrow/
// Enter/Tab, and re-render the React popup via renderer.updateProps so
// the cmdk highlight follows along.

import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { CmdkSlashMenu } from './cmdk-slash-menu';
import { matchSlashItems, type SlashContext, type SlashItem } from './slash-registry';

interface SlashCommandOptions {
  context?: SlashContext;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return { context: {} };
  },

  addProseMirrorPlugins() {
    // Capture context locally so the nested `function syncItems` (whose
    // `this` isn't bound to the extension) can still see the scope filter.
    // Mode items use shouldShow(ctx) to hide themselves on editors with no
    // report context (e.g. profile / settings markdown sections).
    const ctx = this.options.context ?? {};
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => matchSlashItems(query, ctx).slice(0, 50),
        command: ({ editor, range, props }) => {
          const item = props as SlashItem;
          editor.chain().focus().deleteRange(range).run();
          item.command(editor, ctx);
        },
        render: () => {
          let renderer: ReactRenderer | null = null;
          let popup: TippyInstance[] = [];
          let activeIndex = 0;
          let items: SlashItem[] = [];
          // SuggestionKeyDownProps doesn't include `command` — capture the
          // latest one from onStart/onUpdate so onKeyDown can fire selections.
          let runCommand: ((item: SlashItem) => void) | null = null;
          // The grace window stops the gesture that opened the popup (the
          // slash keystroke / "+" click) from closing it the instant it appears.
          let openedAt = 0;
          const GRACE_MS = 250;
          let editorDom: HTMLElement | null = null;
          const dismiss = () => popup[0]?.hide();
          // The slash popup is anchored to a *virtual* reference (the caret
          // rect), which tippy/popper don't auto-track on scroll. Earlier this
          // dismissed the menu on any scroll — but typing near the bottom of the
          // page auto-scrolls the caret into view, which closed the menu mid-type
          // (bug #5). Reposition instead: the popup stays glued to the caret and
          // only closes on Escape, item-select, click-away, or the query going
          // invalid (all handled elsewhere).
          const onScroll = () => {
            popup[0]?.popperInstance?.update();
          };
          const onFocusOut = (e: FocusEvent) => {
            if (Date.now() - openedAt < GRACE_MS) return;
            const next = e.relatedTarget as Node | null;
            // Ignore focus moving into the popup itself (clicking an item).
            if (next && renderer?.element.contains(next)) return;
            dismiss();
          };

          function syncItems(props: SuggestionProps<SlashItem, SlashItem>) {
            items = matchSlashItems(props.query, ctx).slice(0, 50);
            if (activeIndex >= items.length) activeIndex = Math.max(0, items.length - 1);
            if (activeIndex < 0) activeIndex = 0;
          }

          return {
            onStart: props => {
              activeIndex = 0;
              openedAt = Date.now();
              syncItems(props);
              runCommand = (item: SlashItem) => props.command(item);
              renderer = new ReactRenderer(CmdkSlashMenu, {
                props: {
                  query: props.query,
                  activeIndex,
                  items,
                  onSelect: (item: SlashItem) => props.command(item),
                },
                editor: props.editor,
              });
              // Prevent the popup from stealing focus on mousedown — without
              // this, clicking an item blurs the editor, firing onFocusOut and
              // destroying the popup before onSelect lands. preventDefault on
              // mousedown stops the focus shift; the click/onSelect still fires.
              renderer.element.addEventListener('mousedown', e => e.preventDefault());
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: renderer.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
              // Capture phase so scrolls on ANY ancestor scroll container (not
              // just window) reposition the popup to stay glued to the caret.
              window.addEventListener('scroll', onScroll, true);
              editorDom = props.editor.view.dom as HTMLElement;
              editorDom.addEventListener('focusout', onFocusOut);
            },
            onUpdate: props => {
              syncItems(props);
              runCommand = (item: SlashItem) => props.command(item);
              renderer?.updateProps({
                query: props.query,
                activeIndex,
                items,
                onSelect: (item: SlashItem) => props.command(item),
              });
              popup[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
            },
            onKeyDown: props => {
              const k = props.event.key;
              if (k === 'Escape') {
                popup[0]?.hide();
                return true;
              }
              if (k === 'ArrowDown') {
                if (items.length > 0) {
                  activeIndex = (activeIndex + 1) % items.length;
                  renderer?.updateProps({ activeIndex });
                }
                return true;
              }
              if (k === 'ArrowUp') {
                if (items.length > 0) {
                  activeIndex = (activeIndex - 1 + items.length) % items.length;
                  renderer?.updateProps({ activeIndex });
                }
                return true;
              }
              if (k === 'Enter' || k === 'Tab') {
                const sel = items[activeIndex];
                if (sel && runCommand) {
                  runCommand(sel);
                  return true;
                }
              }
              return false;
            },
            onExit: () => {
              window.removeEventListener('scroll', onScroll, true);
              editorDom?.removeEventListener('focusout', onFocusOut);
              editorDom = null;
              popup[0]?.destroy();
              renderer?.destroy();
              runCommand = null;
            },
          };
        },
      } as SuggestionOptions),
    ];
  },
});
