'use client';

// Pipeline (kanban) page — client orchestrator.
//
// Ported 1:1 from legacy public/pipeline.html. Reuses table-filtering /
// table-url-state / TableFilters / FilterPills / BatchActionBar /
// OffersDrawer / RowActionsMenu so search-and-replace stays consistent.
// Net-new for this surface:
//   - Trello-style board (features/pipeline/board.tsx) — dense variant only.
//     Legacy had a classic/dense/funnel switcher behind the design-mocks
//     tweaks panel; per product decision (2026-05-15) we drop the toggle
//     and ship dense as the only variant.
//   - Hash-filter highlight (#status=evaluated dims other columns)
//
// What's deferred:
//   - runEvaluate / evaluateModal background eval — same TODO pattern as
//     features/table/table-page.tsx.

import { ChevronDown, Columns3, Filter, Menu } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionsMenu, type ActionsMenuScope } from '@/components/domain/actions-menu';
import { Button, IconButton } from '@/components/primitives';
import { Topbar } from '@/components/shell/topbar';
import { BatchActionBar } from '@/features/table/batch-action-bar';
import { FilterPills } from '@/features/table/filter-pills';
import { OffersDrawer } from '@/features/table/offers-drawer';
import { RowActionsMenu } from '@/features/table/row-actions-menu';
import { applyFilters, applySort, type TableFilterState } from '@/features/table/table-filtering';
import { TableFilters } from '@/features/table/table-filters';
import type { ApplicationRow, ApplicationsResponse } from '@/features/table/table-types';
import { getActivePills, parseURL, serializeURL } from '@/features/table/table-url-state';
import { stripView, withView } from '@/features/table/view-url';
import { useApplications } from '@/hooks/use-applications';
import { useJobAction } from '@/hooks/use-job-action';
import { useDrawerStore } from '@/stores/drawer-store';
import { useModalStore } from '@/stores/modal-store';
import { Board } from './board';
import { BoardSkeleton } from './board-skeleton';

interface PipelinePageInnerProps {
  initialData?: ApplicationsResponse;
}

function PipelinePageInner({ initialData }: PipelinePageInnerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openDrawer } = useDrawerStore();

  const [filters, setFilters] = useState<TableFilterState>(() => parseURL(searchParams.toString()));
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const [dimOtherKey, setDimOtherKey] = useState<string | null>(null);

  // Whether the device can drag cards. Native HTML5 drag-and-drop (the board's
  // only DnD mechanism) doesn't fire from touch gestures, so the "drag cards
  // between stages" hint is impossible to follow on touch. Default true so SSR
  // / desktop renders the full guidance; flip to false post-mount on coarse,
  // hover-less pointers and drop the drag clause (status changes stay reachable
  // via the per-card status popover everywhere).
  const [canDragCards, setCanDragCards] = useState(true);

  const query = useApplications({ initialData });
  const openModal = useModalStore(s => s.open);
  const { run: runScan } = useJobAction('scan');
  const { run: runBatchEvaluate } = useJobAction('batch-evaluate');

  const closeActionsMenu = useCallback(() => setActionsMenuOpen(false), []);

  // Hydrate hash-filter once on mount. location is browser-only; initialise
  // here so server render is stable.
  useEffect(() => {
    const m = window.location.hash.match(/^#status=([a-z]+)$/);
    if (m) setDimOtherKey(m[1]);
    if (typeof window.matchMedia === 'function') {
      setCanDragCards(!window.matchMedia('(hover: none) and (pointer: coarse)').matches);
    }
  }, []);

  // Add-menu select handler — same dispatch shape as features/table/table-page.tsx.
  //   - 'screen'         → ScreenModal (URL-paste)
  //   - 'scan'           → useJobAction('scan')
  //   - 'batch-evaluate' → useJobAction('batch-evaluate')
  const handleJobAction = useCallback(
    (jobType: string, _scope: ActionsMenuScope) => {
      if (jobType === 'screen') {
        openModal('screen');
        return;
      }
      if (jobType === 'scan') {
        void runScan();
        return;
      }
      if (jobType === 'batch-evaluate') {
        void runBatchEvaluate();
        return;
      }
      console.warn('[actions-menu] unhandled jobType', jobType);
    },
    [openModal, runScan, runBatchEvaluate],
  );

  // Sync filter state → URL (without adding to history). Always preserve
  // `view=kanban` since this component IS the kanban view — dropping it
  // would silently switch the URL back to the default table view.
  useEffect(() => {
    const filtersQs = serializeURL(filters);
    const targetQs = filtersQs ? `${filtersQs}&view=kanban` : 'view=kanban';
    const current = searchParams.toString();
    if (targetQs !== current) {
      router.replace(`/offers?${targetQs}`, { scroll: false });
    }
  }, [filters, router, searchParams]);

  // Sort + filter the flat row list. Legacy pipeline.html getFiltered()
  // (line 1727) → applySort(applyFilters(...)) — identical pipeline.
  const filteredRows = useMemo(() => {
    const entries = query.data?.entries ?? [];
    return applySort(applyFilters(entries, filters), filters.sort);
  }, [filters, query.data?.entries]);

  // Active = non-terminal applications (everything except rejected/discarded).
  const activeCount = useMemo(() => {
    const entries = query.data?.entries ?? [];
    return entries.filter((r: ApplicationRow) => {
      const s = (r.status || '').toLowerCase();
      return s !== 'rejected' && s !== 'discarded';
    }).length;
  }, [query.data?.entries]);

  // Whether any filter is active (score/status/archetype/date/loc/q) — drives
  // the per-column empty copy: "match your filters" vs the neutral "yet".
  const filtersActive = useMemo(() => getActivePills(filters).length > 0, [filters]);

  const openFilterPanel = useCallback(() => setFilterPanelOpen(true), []);
  const closeFilterPanel = useCallback(() => setFilterPanelOpen(false), []);

  // Card click → drawer (single-click handler in BoardCard already debounces
  // by 220ms to let dblclick → /report win). Pass the same-column ordered
  // nums (sort/filter applied) so drawer prev/next walks the user's
  // current column — not raw row order, and not across status columns.
  const handleCardClick = useCallback(
    (num: number) => {
      const clicked = filteredRows.find(r => r.num === num);
      const status = (clicked?.status || '').toLowerCase();
      const columnNums = status
        ? filteredRows.filter(r => (r.status || '').toLowerCase() === status).map(r => r.num)
        : filteredRows.map(r => r.num);
      openDrawer(num, columnNums);
    },
    [openDrawer, filteredRows],
  );

  const handleCardDoubleClick = useCallback(
    (num: number) => {
      // Same as table double-click: navigate to the canonical /report/[num]
      // page via Next router. Legacy used window.location.href.
      router.push(`/report/${num}`);
    },
    [router],
  );

  // Per-card kebab menu — reuses the table RowActionsMenu (full menu:
  // links · apply/follow-up · AI generation · delete) by tracking which
  // num's kebab is open.
  const [openKebabNum, setOpenKebabNum] = useState<number | null>(null);
  const kebabAnchorRef = useRef<HTMLButtonElement | null>(null);

  const handleCardActionsClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, num: number) => {
      e.stopPropagation();
      kebabAnchorRef.current = e.currentTarget;
      setOpenKebabNum(prev => (prev === num ? null : num));
    },
    [],
  );

  const handleKebabClose = useCallback(() => setOpenKebabNum(null), []);

  // Reset selection whenever filters change — preserves the "filter
  // mutation clears the selected set" UX.
  const filtersRef = useRef(filters);
  useEffect(() => {
    if (filtersRef.current !== filters) {
      filtersRef.current = filters;
      // No-op for now — the selection store doesn't need a hard reset because
      // selection is tracked by num, not by visible position. Legacy cleared
      // because its DOM-driven render replaced every node, so stale checkbox
      // visuals would have lingered.
    }
  }, [filters]);

  const openKebabRow = useMemo(() => {
    if (openKebabNum == null) return null;
    return query.data?.entries.find(r => r.num === openKebabNum) ?? null;
  }, [openKebabNum, query.data?.entries]);

  return (
    <>
      <Topbar crumbs={[{ href: '/', label: 'Workspace' }, { label: 'Offers' }]}>
        <div className="view-switcher">
          <Link
            href={stripView(searchParams) ? `/offers?${stripView(searchParams)}` : '/offers'}
            style={{ textDecoration: 'none' }}
          >
            <Menu aria-hidden="true" strokeWidth={2} />
            Table
          </Link>
          <Link
            href={`/offers?${withView(searchParams, 'kanban')}`}
            className="active"
            aria-current="page"
          >
            <Columns3 aria-hidden="true" strokeWidth={2} />
            Kanban
          </Link>
        </div>
        <IconButton
          className="filter-btn"
          label="Filter offers"
          aria-controls="filter-panel"
          aria-expanded={filterPanelOpen}
          onClick={openFilterPanel}
          icon={<Filter aria-hidden="true" strokeWidth={2} size={14} />}
        />
        <Button
          ref={addBtnRef}
          variant="primary"
          className="actions-trigger"
          aria-haspopup="menu"
          aria-expanded={actionsMenuOpen}
          onClick={() => setActionsMenuOpen(v => !v)}
          trailingIcon={
            <ChevronDown className="actions-trigger__chev" aria-hidden="true" strokeWidth={2} />
          }
        >
          Add
        </Button>
        <ActionsMenu
          open={actionsMenuOpen}
          anchorRef={addBtnRef}
          scope="global"
          onClose={closeActionsMenu}
          onSelect={handleJobAction}
        />
      </Topbar>

      <div className="page-head">
        <div>
          <h1>Offers</h1>
          <div className="sub">
            {canDragCards
              ? `${activeCount} active — drag cards between stages as things move.`
              : `${activeCount} active — move cards between stages as things move.`}
          </div>
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="search filter-search"
          id="pipeline-search"
          name="search"
          type="search"
          aria-label="Search offers"
          autoComplete="off"
          placeholder="Search offers…"
          value={filters.q}
          onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
        />
        <div className="active-pills" id="active-pills">
          <FilterPills filters={filters} onChange={setFilters} />
        </div>
      </div>

      <TableFilters
        value={filters}
        onChange={setFilters}
        open={filterPanelOpen}
        onClose={closeFilterPanel}
      />
      <div
        className={filterPanelOpen ? 'filter-panel__backdrop open' : 'filter-panel__backdrop'}
        aria-hidden="true"
        onClick={closeFilterPanel}
      />

      {query.isPending && !query.data ? (
        <BoardSkeleton statusFilter={filters.status} />
      ) : (
        <Board
          rows={filteredRows}
          statusFilter={filters.status}
          filtersActive={filtersActive}
          dimOtherKey={dimOtherKey}
          onCardClick={handleCardClick}
          onCardDoubleClick={handleCardDoubleClick}
          onCardActionsClick={handleCardActionsClick}
          // Per-column "Show 25 more" expansion resets whenever the
          // filter/sort state changes (board-column.tsx).
          resetKey={serializeURL(filters)}
        />
      )}

      <BatchActionBar />
      <OffersDrawer />

      {/* Per-card kebab menu (mounted at body via portal inside the
          component). One open at a time — anchored to whichever .card-actions
          was clicked most recently. */}
      {openKebabRow ? (
        <CardKebabMenu
          row={openKebabRow}
          anchorRef={kebabAnchorRef as React.RefObject<HTMLButtonElement | null>}
          onClose={handleKebabClose}
        />
      ) : null}
    </>
  );
}

// Thin wrapper around RowActionsMenu — reuses the shared full row menu
// (links · apply/follow-up · AI generation · delete) for kanban cards.

interface CardKebabMenuProps {
  row: ApplicationRow;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

function CardKebabMenu({ row, anchorRef, onClose }: CardKebabMenuProps) {
  return <RowActionsMenu open anchorRef={anchorRef} row={row} onClose={onClose} />;
}

interface PipelinePageProps {
  initialData?: ApplicationsResponse;
}

export function PipelinePage({ initialData }: PipelinePageProps = {}) {
  return <PipelinePageInner initialData={initialData} />;
}
