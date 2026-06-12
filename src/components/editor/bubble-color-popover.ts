// Color control for the text-formatting bubble menu (focus menu on a text
// selection). An "A" button that opens a body-anchored popover of text +
// background swatches, applied to the CURRENT SELECTION — unlike the :: block
// menu's Color submenu, which colors the whole block. Same swatches
// (editor-colors) and commands (setColor/unsetColor, setHighlight/unsetHighlight)
// as the block menu; same open/close behaviour (outside-click, Esc, close on
// scroll) as the language picker + slash/:: menus.

import type { Editor as TiptapEditor } from '@tiptap/core';
import { BG_COLORS, type ColorSwatch, TEXT_COLORS } from './editor-colors';
import { makeIcon } from './tiptap-icons';

export function makeBubbleColorButton(editor: TiptapEditor): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'be-mb__btn be-mb__btn--color';
  btn.setAttribute('aria-label', 'Text & highlight color');
  btn.title = 'Text & highlight color';
  // Highlighter icon (the recognizable marker glyph), matching the rest of the
  // bubble menu's stroke icons. The popover still covers text + background.
  btn.appendChild(makeIcon('highlight'));

  let pop: HTMLDivElement | null = null;

  const position = () => {
    if (!pop) return;
    const r = btn.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let top = r.bottom + 6;
    if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;
    let left = r.left;
    if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
    pop.style.top = `${Math.max(8, top)}px`;
    pop.style.left = `${Math.max(8, left)}px`;
  };

  const close = () => {
    if (!pop) return;
    pop.remove();
    pop = null;
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', position);
  };

  const onDown = (e: MouseEvent) => {
    const t = e.target as Node;
    if (pop && !pop.contains(t) && !btn.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  // Close on a page/ancestor scroll, but NOT when scrolling inside the popover
  // itself (it overflows + scrolls) — the capture-phase listener catches those
  // too, which was closing the popover the moment the user scrolled its swatches.
  const onScroll = (e: Event) => {
    if (pop && e.target instanceof Node && pop.contains(e.target)) return;
    close();
  };

  const swatch = (kind: 'text' | 'bg', c: ColorSwatch, apply: () => void): HTMLButtonElement => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'be-colorpop__item';
    const ic = document.createElement('span');
    ic.className = `be-colorpop__ic${kind === 'bg' ? ' be-colorpop__ic--bg' : ''}`;
    if (kind === 'text') {
      ic.textContent = 'A';
      if (c.value) ic.style.color = c.value;
    } else if (c.value) {
      ic.style.background = c.value;
    }
    item.appendChild(ic);
    const lbl = document.createElement('span');
    lbl.className = 'be-colorpop__label';
    lbl.textContent = c.value === '' ? (kind === 'text' ? 'Default' : 'None') : c.name;
    item.appendChild(lbl);
    // mousedown + preventDefault keeps the editor selection alive while we apply.
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      apply();
      close();
      editor.view.focus();
    });
    return item;
  };

  const open = () => {
    if (pop) {
      close();
      return;
    }
    pop = document.createElement('div');
    pop.className = 'be-colorpop';
    const chain = () => editor.chain().focus();

    const textHead = document.createElement('div');
    textHead.className = 'be-colorpop__head';
    textHead.textContent = 'Text';
    pop.appendChild(textHead);
    for (const c of TEXT_COLORS) {
      pop.appendChild(
        swatch('text', c, () =>
          c.value === '' ? chain().unsetColor().run() : chain().setColor(c.value).run(),
        ),
      );
    }

    const bgHead = document.createElement('div');
    bgHead.className = 'be-colorpop__head';
    bgHead.textContent = 'Background';
    pop.appendChild(bgHead);
    for (const c of BG_COLORS) {
      pop.appendChild(
        swatch('bg', c, () =>
          c.value === ''
            ? chain().unsetHighlight().run()
            : chain().setHighlight({ color: c.value }).run(),
        ),
      );
    }

    document.body.appendChild(pop);
    position();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', position);
  };

  btn.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  return btn;
}
