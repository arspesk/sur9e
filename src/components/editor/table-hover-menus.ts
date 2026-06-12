// Notion-style row + column grip handles for tables.
//
// On hover of any table cell we surface two small grip affordances:
//   - column grip:  centered above the hovered column's top edge
//   - row grip:     centered to the left of the hovered row's left edge
// Clicking a grip opens a vertical .be-bm dropdown scoped to that axis
// (insert before/after, toggle header, delete row/column, delete table).
//
// Replaces the prior horizontal BubbleMenu that surfaced all eight icons
// at once over the table caret — that menu's all-identical `+` and trash
// icons made the actions unreadable (APE table-menu UX feedback). The
// grip pattern keeps the table chrome quiet until the user reaches for
// it.

import type { Editor as TiptapEditor } from '@tiptap/core';
import { makeIcon } from './tiptap-icons';

interface RowOpts {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

function row({ icon, label, danger, onClick }: RowOpts): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `be-bm__item${danger ? ' is-danger' : ''}`;
  btn.setAttribute('role', 'menuitem');
  const iconWrap = document.createElement('span');
  iconWrap.className = 'be-bm__icon';
  iconWrap.appendChild(makeIcon(icon));
  btn.appendChild(iconWrap);
  const lbl = document.createElement('span');
  lbl.className = 'be-bm__label';
  lbl.textContent = label;
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

export interface TableHoverHandle {
  destroy: () => void;
}

export function mountTableHoverMenus(
  editor: TiptapEditor,
  editorEl: HTMLElement,
): TableHoverHandle {
  // Single shared menu element — only one axis open at a time.
  const menu = document.createElement('div');
  menu.className = 'be-bm';
  menu.setAttribute('role', 'menu');
  menu.style.display = 'none';
  document.body.appendChild(menu);

  // Two grip affordances. Always in the DOM; positioned/hidden via CSS
  // visibility so the layout doesn't reflow on every hover.
  const colGrip = makeGrip('col');
  const rowGrip = makeGrip('row');
  document.body.appendChild(colGrip);
  document.body.appendChild(rowGrip);

  function makeGrip(axis: 'row' | 'col'): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `be-th-grip be-th-grip--${axis}`;
    b.setAttribute('aria-label', axis === 'col' ? 'Column options' : 'Row options');
    // Visual axis hint: col grip uses grip-horizontal (≡), row grip uses
    // grip-vertical (||) so the icon orientation matches the affordance.
    b.appendChild(makeIcon(axis === 'col' ? 'gripHorizontal' : 'grip'));
    return b;
  }

  // Current hovered cell (used by grip click handlers to know which row/col
  // the menu should act on — set before each grip click via the mouseover).
  let currentCell: HTMLTableCellElement | null = null;

  function positionGrips(cell: HTMLTableCellElement) {
    const tr = cell.parentElement as HTMLTableRowElement | null;
    const tbl = cell.closest('table');
    if (!tr || !tbl) return;
    const cellRect = cell.getBoundingClientRect();
    const trRect = tr.getBoundingClientRect();
    const tblRect = tbl.getBoundingClientRect();
    // Column grip: top of the table, horizontally centered on the cell.
    colGrip.style.top = `${tblRect.top + window.scrollY - 22}px`;
    colGrip.style.left = `${cellRect.left + window.scrollX + cellRect.width / 2 - 11}px`;
    colGrip.style.visibility = 'visible';
    // Row grip: left of the table, vertically centered on the row.
    rowGrip.style.top = `${trRect.top + window.scrollY + trRect.height / 2 - 11}px`;
    rowGrip.style.left = `${tblRect.left + window.scrollX - 22}px`;
    rowGrip.style.visibility = 'visible';
  }

  function hideGrips() {
    colGrip.style.visibility = 'hidden';
    rowGrip.style.visibility = 'hidden';
  }

  function closeMenu() {
    menu.style.display = 'none';
  }

  function openMenu(axis: 'row' | 'col', anchor: HTMLElement) {
    if (!currentCell) return;
    // Move ProseMirror selection into the hovered cell so addRowBefore /
    // deleteColumn / toggleHeaderRow / etc. act on the right cell. Without
    // this they'd target the previous caret position, which is the wrong
    // row + column when the user was editing elsewhere.
    const view = editor.view;
    const cellPos = view.posAtDOM(currentCell, 0);
    if (cellPos >= 0) {
      editor
        .chain()
        .focus()
        .setTextSelection(cellPos + 1)
        .run();
    }
    menu.replaceChildren();
    menu.appendChild(header(axis === 'col' ? 'Column' : 'Row'));
    const items = axis === 'col' ? columnItems() : rowItems();
    for (const it of items) menu.appendChild(it);
    menu.appendChild(sep());
    menu.appendChild(
      row({
        icon: 'trash',
        label: 'Delete table',
        danger: true,
        onClick: () => {
          editor.chain().focus().deleteTable().run();
          closeMenu();
          hideGrips();
        },
      }),
    );
    menu.style.display = 'flex';
    const m = menu.getBoundingClientRect();
    const aR = anchor.getBoundingClientRect();
    let top = aR.bottom + 4;
    let left = aR.left;
    if (top + m.height > window.innerHeight - 8) top = aR.top - m.height - 4;
    if (left + m.width > window.innerWidth - 8) left = window.innerWidth - m.width - 8;
    // .be-bm is `position: fixed` — top/left are VIEWPORT coordinates, so
    // we DON'T add window.scrollY/X. Earlier I copied the grip's
    // absolute-coords math which left the menu scrollY pixels off-screen
    // (every drop-down opened way below where the grip was clicked).
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${Math.max(8, left)}px`;
  }

  function columnItems(): HTMLElement[] {
    return [
      row({
        icon: 'h1',
        label: 'Toggle header column',
        onClick: () => {
          editor.chain().focus().toggleHeaderColumn().run();
          closeMenu();
        },
      }),
      row({
        icon: 'arrowLeft',
        label: 'Insert column left',
        onClick: () => {
          editor.chain().focus().addColumnBefore().run();
          closeMenu();
        },
      }),
      row({
        icon: 'arrowRight',
        label: 'Insert column right',
        onClick: () => {
          editor.chain().focus().addColumnAfter().run();
          closeMenu();
        },
      }),
      sep(),
      row({
        icon: 'trash',
        label: 'Delete column',
        danger: true,
        onClick: () => {
          editor.chain().focus().deleteColumn().run();
          closeMenu();
        },
      }),
    ];
  }

  function rowItems(): HTMLElement[] {
    return [
      row({
        icon: 'h1',
        label: 'Toggle header row',
        onClick: () => {
          editor.chain().focus().toggleHeaderRow().run();
          closeMenu();
        },
      }),
      row({
        icon: 'arrowUp',
        label: 'Insert row above',
        onClick: () => {
          editor.chain().focus().addRowBefore().run();
          closeMenu();
        },
      }),
      row({
        icon: 'arrowDown',
        label: 'Insert row below',
        onClick: () => {
          editor.chain().focus().addRowAfter().run();
          closeMenu();
        },
      }),
      sep(),
      row({
        icon: 'trash',
        label: 'Delete row',
        danger: true,
        onClick: () => {
          editor.chain().focus().deleteRow().run();
          closeMenu();
        },
      }),
    ];
  }

  // Hover lifecycle: the grips live in document.body (so they can position
  // outside the editor's overflow box), but the cell hover event happens on
  // editorEl. When the cursor moves cell → grip it crosses non-grip body
  // territory; without explicit hover guards on the grips themselves the
  // mouseout-on-cell hide timer would fire and the grip would vanish before
  // the user could click it. The bookkeeping below tracks "is any
  // table-affordance currently hot?" — true while hovering a cell OR a
  // grip OR the open menu. Hide only fires after a grace period of all
  // three being cold.
  let hoverGrace: ReturnType<typeof setTimeout> | null = null;
  let cellHot = false;
  let gripHot = false;

  function maybeHide() {
    if (hoverGrace) clearTimeout(hoverGrace);
    hoverGrace = setTimeout(() => {
      if (menu.style.display === 'flex') return;
      if (cellHot || gripHot) return;
      hideGrips();
    }, 600);
  }
  function cancelHide() {
    if (hoverGrace) clearTimeout(hoverGrace);
    hoverGrace = null;
  }

  function onMouseOver(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const cell = target.closest('td, th') as HTMLTableCellElement | null;
    if (!cell || !editorEl.contains(cell)) return;
    cellHot = true;
    cancelHide();
    currentCell = cell;
    positionGrips(cell);
  }

  function onMouseOut(e: MouseEvent) {
    const related = e.relatedTarget as HTMLElement | null;
    // Staying inside the same cell or moving between cells of the same
    // table → still a table hover, no hide needed.
    if (related?.closest('table') && editorEl.contains(related)) return;
    cellHot = false;
    maybeHide();
  }

  function onGripEnter() {
    gripHot = true;
    cancelHide();
  }
  function onGripLeave() {
    gripHot = false;
    maybeHide();
  }

  function onDocMouseDown(e: MouseEvent) {
    if (menu.style.display !== 'flex') return;
    if (menu.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest('.be-th-grip')) return;
    closeMenu();
  }

  function onResize() {
    closeMenu();
    hideGrips();
  }

  function onScrollReposition() {
    // Reposition grips on scroll so they don't lag behind the table.
    if (currentCell && document.body.contains(currentCell)) {
      positionGrips(currentCell);
    }
  }

  for (const g of [colGrip, rowGrip]) {
    g.addEventListener('mouseenter', onGripEnter);
    g.addEventListener('mouseleave', onGripLeave);
  }
  colGrip.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    openMenu('col', colGrip);
  });
  rowGrip.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    openMenu('row', rowGrip);
  });

  editorEl.addEventListener('mouseover', onMouseOver);
  editorEl.addEventListener('mouseout', onMouseOut);
  document.addEventListener('mousedown', onDocMouseDown, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScrollReposition, true);

  return {
    destroy() {
      editorEl.removeEventListener('mouseover', onMouseOver);
      editorEl.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('mousedown', onDocMouseDown, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScrollReposition, true);
      colGrip.remove();
      rowGrip.remove();
      menu.remove();
      if (hoverGrace) clearTimeout(hoverGrace);
    },
  };
}
