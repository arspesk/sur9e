// In-app link popover. Replaces window.prompt() with a real input
// anchored at the current selection. Enter confirms, Escape cancels,
// trash removes the link if one is already present.
//
// Verbatim port of public/tiptap-link-popover.js.

import type { Editor as TiptapEditor } from '@tiptap/core';
import { makeIcon } from './tiptap-icons';

export interface LinkPopoverHandle {
  open: () => void;
  close: () => void;
  destroy: () => void;
}

export function mountLinkPopover(editor: TiptapEditor): LinkPopoverHandle {
  let pop: HTMLDivElement | null = null;
  let input: HTMLInputElement | null = null;

  function build() {
    const root = document.createElement('div');
    root.className = 'be-linkpop';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Edit link');

    const inp = document.createElement('input');
    inp.type = 'url';
    inp.className = 'be-linkpop__input';
    inp.placeholder = 'Paste link';
    inp.spellcheck = false;
    inp.autocomplete = 'off';
    root.appendChild(inp);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'be-linkpop__btn';
    openBtn.title = 'Open link';
    openBtn.setAttribute('aria-label', 'Open link in a new tab');
    openBtn.appendChild(makeIcon('external'));
    root.appendChild(openBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'be-linkpop__btn';
    removeBtn.title = 'Remove link';
    removeBtn.setAttribute('aria-label', 'Remove link');
    removeBtn.appendChild(makeIcon('trash'));
    root.appendChild(removeBtn);

    openBtn.addEventListener('mousedown', e => {
      e.preventDefault();
      openLink();
    });

    document.body.appendChild(root);

    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    inp.addEventListener('blur', () => {
      // Close after a tick so a click on the trash button still registers
      setTimeout(() => {
        if (document.activeElement !== inp && !root.contains(document.activeElement)) close();
      }, 100);
    });
    removeBtn.addEventListener('mousedown', e => {
      e.preventDefault();
      remove();
    });

    pop = root;
    input = inp;
  }

  function position() {
    if (!pop) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r) return;
    const popRect = pop.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.left;
    if (top + popRect.height > window.innerHeight - 8) {
      top = r.top - popRect.height - 6;
    }
    if (left + popRect.width > window.innerWidth - 8) {
      left = window.innerWidth - popRect.width - 8;
    }
    if (left < 8) left = 8;
    pop.style.top = `${Math.max(8, top)}px`;
    pop.style.left = `${left}px`;
  }

  function open() {
    if (!pop) build();
    if (!pop || !input) return;
    pop.style.display = 'flex';
    // Pre-fill if cursor is inside an existing link
    const existing = (editor.getAttributes('link') as { href?: string })?.href || '';
    input.value = existing;
    position();
    setTimeout(() => input?.focus(), 10);
  }

  function close() {
    if (pop) pop.style.display = 'none';
  }

  function commit() {
    if (!input) return;
    const url = (input.value || '').trim();
    if (!url) {
      remove();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    close();
  }

  function remove() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    close();
  }

  function openLink() {
    // Prefer the field's current value (lets you open before committing);
    // fall back to the href stored on the existing link mark.
    const url =
      (input?.value || '').trim() ||
      (editor.getAttributes('link') as { href?: string })?.href ||
      '';
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Reposition on scroll/resize while open
  const onResize = () => {
    if (pop && pop.style.display === 'flex') position();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);

  return {
    open,
    close,
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      if (pop) {
        pop.remove();
        pop = null;
      }
    },
  };
}
