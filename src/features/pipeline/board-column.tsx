'use client';

// Single status column on the kanban board.
//
// Ported 1:1 from legacy pipeline.html renderColumn() (lines 1298-1339).
// DOM: <div class="column" data-status>
//        <div class="col-head">
//          <div class="col-head-row">
//            <div class="col-title-block"><.col-dot/><.col-title/></div>
//            <span class="col-count"/>
//          </div>
//          <div class="col-density"/>      (Dense variant only)
//        </div>
//        <div class="col-body">cards | .col-empty</div>
//      </div>
//
// Large-offer-sets design (2026-06-10): each column mounts only the first
// COLUMN_WINDOW cards of its ordered list (a head-slice of the rowsByStatus
// order, which preserves the user's applySort(applyFilters(...)) pipeline —
// never a separate per-column heuristic) plus a "Show 25 more" expander.
// The Discarded count stub composes with this: expanding the stub reveals
// the windowed list, not all ~500 cards at once.

import { useEffect, useRef, useState } from 'react';
import type { ApplicationRow } from '@/features/table/table-types';
import { useDrawerStore } from '@/stores/drawer-store';
import { BoardCard } from './board-card';
import type { BoardColumn as BoardColumnDef, ColumnKey } from './board-types';
import {
  COLUMN_WINDOW,
  nextWindow,
  remainingCount,
  windowCards,
  windowForIndex,
} from './board-window';

// A collapsible column above this many cards renders a count stub instead of
// the cards themselves. The Discarded column routinely holds hundreds of
// terminal cards (486 at last census — ~7.5x the rest of the board combined);
// mounting them all costs ~10k DOM nodes + ~3k interactive elements for
// content nobody is working. Below the threshold the cards are cheap enough
// that hiding them would just add a click. 12 matches the density-strip cap.
const COLLAPSE_THRESHOLD = 12;

// How many frames to wait for an auto-expanded card to mount before
// scrolling it into view (the expansion commits on the next React render).
const SCROLL_RETRY_FRAMES = 12;

function scrollCardIntoView(body: HTMLElement | null, num: number, framesLeft: number): void {
  if (!body) return;
  const card = body.querySelector<HTMLElement>(`.card[data-num="${num}"]`);
  if (card) {
    card.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (framesLeft > 0) {
    requestAnimationFrame(() => scrollCardIntoView(body, num, framesLeft - 1));
  }
}

interface BoardColumnProps {
  column: BoardColumnDef;
  items: ApplicationRow[];
  selectedNums: Set<number>;
  allInColumnSelected: boolean;
  onTitleClick: (statusKey: ColumnKey) => void;
  onCardClick: (num: number) => void;
  onCardDoubleClick: (num: number) => void;
  onCardActionsClick: (e: React.MouseEvent<HTMLButtonElement>, num: number) => void;
  onCardDragStart: (e: React.DragEvent<HTMLDivElement>, num: number) => void;
  onCardDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  onColumnDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onColumnDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onColumnDrop: (e: React.DragEvent<HTMLDivElement>, statusKey: ColumnKey) => void;
  isDragOver: boolean;
  // Mobile/legacy parity: a column may be visually dimmed via #status=key
  // hash filter — handled by parent via inline style.
  dimmed?: boolean;
  // When any filter is active, an empty column reads "match your filters"
  // instead of the neutral "yet" (the stage is empty because filters hid it,
  // not because nothing's reached that stage).
  filtersActive?: boolean;
  // Terminal columns (Discarded) collapse to a count stub above
  // COLLAPSE_THRESHOLD cards; the user expands on demand. The column header
  // count, density strip, and drop-target behavior are unaffected — only the
  // card mounting is deferred.
  collapsible?: boolean;
  // Serialized filter/sort state — window + stub expansion reset whenever it
  // changes (both live in the same filters object upstream).
  resetKey: string;
}

export function BoardColumn({
  column,
  items,
  selectedNums,
  allInColumnSelected,
  onTitleClick,
  onCardClick,
  onCardDoubleClick,
  onCardActionsClick,
  onCardDragStart,
  onCardDragEnd,
  onColumnDragOver,
  onColumnDragLeave,
  onColumnDrop,
  isDragOver,
  dimmed,
  filtersActive,
  collapsible,
  resetKey,
}: BoardColumnProps) {
  // Expansion is per-mount, intentionally not persisted: the collapse exists
  // to keep the default board light, and a returning user starts from the
  // light state again.
  const [expanded, setExpanded] = useState(false);
  // Per-column card window (head-slice of `items`); grows by COLUMN_WINDOW
  // per "Show 25 more" click.
  const [visibleCount, setVisibleCount] = useState(COLUMN_WINDOW);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Filter/sort changes reset both the window and the Discarded stub.
  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    setExpanded(false);
    setVisibleCount(COLUMN_WINDOW);
  }, [resetKey]);

  // Filters can shrink the set under the threshold — then the (few) matching
  // cards just render, no stub. Search results are never hidden behind more
  // than one click.
  const collapsed = Boolean(collapsible) && !expanded && items.length > COLLAPSE_THRESHOLD;

  // Drawer prev/next walks the FULL ordered column list (it operates on
  // nums, not DOM). When it reaches a card past the window — or inside the
  // collapsed Discarded stub — expand just enough to mount it and scroll it
  // into view so the highlighted card stays visible behind the drawer.
  const drawerNum = useDrawerStore(s => (s.open ? s.num : null));
  useEffect(() => {
    if (drawerNum == null) return;
    const index = items.findIndex(r => r.num === drawerNum);
    if (index === -1) return;
    if (collapsed) setExpanded(true);
    if (index >= visibleCount) setVisibleCount(windowForIndex(index));
    scrollCardIntoView(bodyRef.current, drawerNum, SCROLL_RETRY_FRAMES);
  }, [drawerNum, items, collapsed, visibleCount]);

  // Windowed card list — pure head-slice of the column's pipeline order.
  const visible = windowCards(items, visibleCount);
  const remaining = remainingCount(items.length, visibleCount);

  // Density strip — always shown (we ship dense as the only variant).
  // Max 12 bars, opacity by score / 5, best scores first (legacy semantics:
  // the strip summarizes the column's strongest cards). Legacy lines 1305-1311.
  const byScore = items
    .slice()
    .sort((a, b) => (Number.parseFloat(b.score) || 0) - (Number.parseFloat(a.score) || 0));
  const showDensity = items.length > 0;

  return (
    <div
      className={`column${isDragOver ? ' drag-over' : ''}`}
      data-status={column.key}
      style={dimmed ? { opacity: 0.3 } : undefined}
      onDragOver={e => {
        e.preventDefault();
        onColumnDragOver(e);
      }}
      onDragLeave={onColumnDragLeave}
      onDrop={e => {
        e.preventDefault();
        onColumnDrop(e, column.key);
      }}
    >
      <div className="col-head">
        <div className="col-head-row">
          <div className="col-title-block">
            <span className={`col-dot ${column.key}`}></span>
            <span
              className="col-title"
              data-status={column.key}
              data-all-selected={allInColumnSelected ? 'true' : 'false'}
              role="button"
              tabIndex={0}
              aria-label={`Select all ${column.label} offers`}
              aria-pressed={allInColumnSelected}
              title={`Select all ${column.label} offers`}
              onClick={e => {
                e.stopPropagation();
                onTitleClick(column.key);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onTitleClick(column.key);
                }
              }}
            >
              {column.label}
            </span>
          </div>
          <span className="col-count">{items.length}</span>
        </div>
        {showDensity ? (
          <div className="col-density" style={{ color: `var(--s-${column.key})` }}>
            {byScore.slice(0, 12).map((it, i) => {
              const score = Number.parseFloat(it.score) || 0;
              const op = Math.max(0.2, Math.min(1, score / 5));
              return <span key={i} className="bar" style={{ opacity: op }}></span>;
            })}
          </div>
        ) : null}
      </div>
      <div className="col-body" ref={bodyRef}>
        {items.length === 0 ? (
          <div className="col-empty">
            {/* No label interpolation: "No offers in Offer received yet."
                reads broken. The column header right above provides the
                context. */}
            {filtersActive ? 'No offers match your filters.' : 'No offers yet.'}
          </div>
        ) : collapsed ? (
          // Count stub — reuses the .col-empty placeholder surface (no new
          // CSS; the responsive agent owns the stylesheets). The column stays
          // a live drop target while collapsed: the drag handlers live on the
          // column wrapper above, so cards can still be dropped here.
          <div className="col-empty" style={{ flexDirection: 'column', gap: 10 }}>
            <span>{items.length} cards collapsed to keep the board fast — drop still works.</span>
            <button
              type="button"
              className="btn"
              // .col-empty is italic placeholder copy; keep the action upright
              // so it reads as a button, not part of the sentence.
              style={{ fontStyle: 'normal' }}
              aria-expanded={false}
              onClick={() => setExpanded(true)}
            >
              Show cards
            </button>
          </div>
        ) : (
          <>
            {collapsible && items.length > COLLAPSE_THRESHOLD ? (
              <button
                type="button"
                className="btn col-window-btn"
                aria-expanded={true}
                onClick={() => {
                  setExpanded(false);
                  setVisibleCount(COLUMN_WINDOW);
                }}
              >
                Hide {items.length} cards
              </button>
            ) : null}
            {visible.map(row => (
              <BoardCard
                key={row.num}
                row={row}
                isSelected={selectedNums.has(row.num)}
                onClick={onCardClick}
                onDoubleClick={onCardDoubleClick}
                onActionsClick={onCardActionsClick}
                onDragStart={onCardDragStart}
                onDragEnd={onCardDragEnd}
              />
            ))}
            {remaining > 0 ? (
              <button
                type="button"
                className="btn col-window-btn"
                onClick={() => setVisibleCount(nextWindow)}
              >
                Show {Math.min(COLUMN_WINDOW, remaining)} more ({remaining} hidden)
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
