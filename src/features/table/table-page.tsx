'use client';

import { Columns3, Filter, Menu } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ActionsMenuScope } from '@/components/domain/actions-menu';
import { IconButton } from '@/components/primitives';
import { Topbar } from '@/components/shell/topbar';
import { useApplications } from '@/hooks/use-applications';
import { useJobAction } from '@/hooks/use-job-action';
import type { OnboardingMissing } from '@/lib/server/onboarding-status';
import { useModalStore } from '@/stores/modal-store';
import { useSelectionStore } from '@/stores/selection-store';
import { BatchActionBar } from './batch-action-bar';
import { FilterPills } from './filter-pills';
import { useCellClipFade } from './hooks/use-cell-clip-fade';
import { useRowResize } from './hooks/use-row-resize';
import { useScrollEdgeFade } from './hooks/use-scroll-edge-fade';
import { useTableKeyboard } from './hooks/use-table-keyboard';
import { OffersDrawer } from './offers-drawer';
import { OffersTable } from './offers-table';
import { TableActions } from './table-actions';
import { tableBootScript } from './table-boot';
import { applyFilters, applySort, type TableFilterState } from './table-filtering';
import { TableFilters } from './table-filters';
import { SkeletonRow } from './table-loading';
import type { ApplicationRow, ApplicationsResponse } from './table-types';
import { parseURL, serializeURL } from './table-url-state';
import { stripView, withView } from './view-url';

// 'posted' has no column header today (it's reachable from the filter
// panel's Sort by), but defaults desc like 'date' if a header ever cycles it.
const NUMERIC_DESC_KEYS = new Set(['num', 'score', 'date', 'posted', 'comp']);
const COL_WIDTHS_KEY = 'sur9e.table.colWidths';

/* Inline scripts only execute when the browser parses them out of
   server-rendered HTML; a <script> created by React during a client render
   (client-side nav to this page) is inert, and React 19 dev logs
   "Encountered a script tag while rendering React component" for it.
   useSyncExternalStore is the discriminator: getServerSnapshot (true) is
   used for SSR + hydration — the only case where the tag does anything —
   and getSnapshot (false) for fresh client mounts, where we skip it.
   Post-hydration the flag flips to false and React removes the element;
   by then it has already run during parse. */
const noopSubscribe = () => () => {};
function useIsServerRendered(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => false,
    () => true,
  );
}

interface TablePageInnerProps {
  initialData?: ApplicationsResponse;
  /** First-run preflight (from the RSC page): which personalization files are missing. */
  setupMissing?: OnboardingMissing[];
}

function TablePageInner({ initialData, setupMissing }: TablePageInnerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isServerRendered = useIsServerRendered();

  const [filters, setFilters] = useState<TableFilterState>(() => {
    return parseURL(searchParams.toString());
  });
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const tableRef = useRef<HTMLTableElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const query = useApplications({ initialData });
  const selected = useSelectionStore(s => s.selected);
  const setAll = useSelectionStore(s => s.setAll);
  const clear = useSelectionStore(s => s.clear);
  const openModal = useModalStore(s => s.open);
  const { run: runScan } = useJobAction('scan');
  const { run: runBatchEvaluate } = useJobAction('batch-evaluate');

  // Legacy Add-menu select handler (table.html lines 1629-1639). Maps the
  // three global menu items (screen, scan, batch-evaluate) onto the modal
  // store + useJobAction:
  //   - 'screen'         → URL-paste modal (ScreenModal) — owns its own POST
  //   - 'scan'           → POST /api/jobs/scan via useJobAction
  //   - 'batch-evaluate' → POST /api/jobs/batch-evaluate via useJobAction
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

  // Filtering 552 rows re-renders the whole <tbody> — too heavy to run
  // inside every keystroke's input event (erasing the query is the worst
  // case: each backspace widens the match set). Deferring keeps the
  // controlled input on the urgent lane while the table re-render is
  // interruptible by the next keystroke.
  const deferredFilters = useDeferredValue(filters);
  const rows = useMemo(() => {
    const entries = query.data?.entries ?? [];
    return applySort(applyFilters(entries, deferredFilters), deferredFilters.sort);
  }, [deferredFilters, query.data?.entries]);

  // Sync filter state → URL (without adding to history). Strip `view`
  // from the current-URL comparison: this component IS the table view
  // (default), so the param is dropped on rewrite — keeps URLs clean and
  // avoids a ping-pong with the view-switcher's own writes. Keyed to
  // deferredFilters, not filters: router.replace per keystroke is real
  // router work that made typing lag, and React's deferral already
  // coalesces bursts — the URL updates exactly when the rows do. The
  // compare reads window.location.search at effect time, NOT
  // useSearchParams() — the hook's snapshot lags router.replace and a
  // stale match silently skips the sync (the bug where clearing the
  // search left ?q= in the URL).
  useEffect(() => {
    const qs = serializeURL(deferredFilters);
    const stripView = new URLSearchParams(window.location.search);
    stripView.delete('view');
    if (qs !== stripView.toString()) {
      router.replace(qs ? `/offers?${qs}` : '/offers', { scroll: false });
    }
  }, [deferredFilters, router]);

  const openFilterPanel = useCallback(() => setFilterPanelOpen(true), []);
  const closeFilterPanel = useCallback(() => setFilterPanelOpen(false), []);

  // Column-header sort: clicking a th toggles the sort direction.
  // First click on a new column sets the "natural" default direction
  // (desc for numeric keys, asc for text keys). Second click flips direction.
  function toggleHeaderSort(key: string) {
    setFilters(f => {
      if (f.sort.key === key) {
        return { ...f, sort: { ...f.sort, dir: f.sort.dir === 'asc' ? 'desc' : 'asc' } };
      }
      const dir = NUMERIC_DESC_KEYS.has(key) ? 'desc' : 'asc';
      return { ...f, sort: { key, dir } };
    });
  }

  // Keyboard handler for sort headers — delegates to useTableKeyboard hook
  const { getSortKeyDown } = useTableKeyboard({ onSort: toggleHeaderSort });

  // Column resize (mirrors legacy: pointer-based drag, localStorage persist)
  useRowResize({
    tableRef,
    storageKey: COL_WIDTHS_KEY,
    resetButtonSelector: '.fp-reset-layout',
  });

  // Fade the right edge of any cell whose content is clipped (replaces the
  // hard "…" ellipsis). Re-measures on resize / data changes.
  useCellClipFade(tableRef);

  // Fade the table's left/right edges while there's content scrolled out of
  // view horizontally (kanban-style scroll affordance).
  useScrollEdgeFade(wrapRef);

  const totalCount = query.data?.entries?.length ?? 0;
  const rowCount = query.data
    ? rows.length === totalCount
      ? `${totalCount} offers`
      : `${rows.length} of ${totalCount} offers`
    : '…';

  // "Waiting on you" = screened (evaluated, not yet applied) + responded
  // (they replied, you owe a reply). Locked in the 2026-06-04 polish spec.
  const waitingCount = useMemo(() => {
    const entries = query.data?.entries ?? [];
    return entries.filter((e: ApplicationRow) => {
      const s = (e.status || '').toLowerCase();
      return s === 'screened' || s === 'responded';
    }).length;
  }, [query.data?.entries]);

  const allRowNums = rows.map(r => r.num);
  const allSelected = allRowNums.length > 0 && allRowNums.every(n => selected.has(n));
  const someSelected = selected.size > 0 && !allSelected;

  function handleSelectAll(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.checked) setAll(allRowNums);
    else clear();
  }

  const COL_SUFFIX: Record<string, string> = {
    company: 'co',
    archetype: 'arch',
    work_mode: 'mode',
  };

  // Helper to compute sort-active / sort-asc classes and aria-sort
  function sortProps(key: string) {
    const active = filters.sort.key === key;
    const asc = active && filters.sort.dir === 'asc';
    return {
      className:
        `col-${COL_SUFFIX[key] ?? key} ${active ? 'sort-active' : ''} ${asc ? 'sort-asc' : ''}`.trim(),
      'aria-sort': (!active ? 'none' : asc ? 'ascending' : 'descending') as
        | 'none'
        | 'ascending'
        | 'descending',
      tabIndex: 0,
      onClick: () => toggleHeaderSort(key),
      onKeyDown: getSortKeyDown(key),
    };
  }

  return (
    <>
      <Topbar crumbs={[{ href: '/', label: 'Workspace' }, { label: 'Offers' }]}>
        <div className="view-switcher">
          <Link
            href={searchParams.toString() ? `/offers?${stripView(searchParams)}` : '/offers'}
            className="active"
            aria-current="page"
          >
            <Menu aria-hidden="true" strokeWidth={2} />
            Table
          </Link>
          <Link
            href={`/offers?${withView(searchParams, 'kanban')}`}
            style={{ textDecoration: 'none' }}
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
        <TableActions onJobAction={handleJobAction} />
      </Topbar>

      {/* Contained-scroll shell (Airtable/Linear data-grid layout): the
          page-head + filter-bar are fixed-height flex children and the
          .table-wrap below is the lone scroll viewport (both axes). The
          shell is scoped so no other route's .page-head / .filter-bar /
          .table-wrap is affected. The off-canvas filter panel + backdrop
          are position:fixed, so they're layout-neutral inside the flex. */}
      <div className="offers-shell">
        <div className="page-head">
          <div>
            <h1>Offers</h1>
            <div className="sub" id="tableSub">
              <span id="tableRowCount">{rowCount}</span>
              {waitingCount > 0 ? <> · {waitingCount} waiting on you</> : null} — click a row to
              open its report
            </div>
          </div>
        </div>

        <div className="filter-bar">
          <input
            className="search filter-search"
            id="table-search"
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

        <div className="table-wrap" ref={wrapRef}>
          {/* aria-rowcount: under windowed rendering only ~40 rows are in the
            DOM at a time — announce the real size (header row + data rows);
            mounted rows carry matching aria-rowindex. */}
          <table className="offers" id="offersTable" ref={tableRef} aria-rowcount={rows.length + 1}>
            <thead>
              <tr>
                <th scope="col" className="col-select">
                  <input
                    type="checkbox"
                    id="select-all"
                    aria-label="Select all visible rows"
                    checked={allSelected}
                    ref={el => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={handleSelectAll}
                  />
                </th>
                <th
                  scope="col"
                  {...sortProps('num')}
                  style={{ width: '76px' }}
                  data-sort-key="num"
                  title="Report number"
                  aria-label="Report number"
                >
                  #
                </th>
                <th scope="col" {...sortProps('company')} data-sort-key="company">
                  Company
                </th>
                <th scope="col" {...sortProps('role')} data-sort-key="role">
                  Role
                </th>
                <th scope="col" {...sortProps('status')} data-sort-key="status">
                  Status
                </th>
                <th scope="col" {...sortProps('score')} data-sort-key="score">
                  Score
                </th>
                {/* Order after Score: dropdown fields → inline-edit fields → date. */}
                <th scope="col" {...sortProps('seniority')} data-sort-key="seniority">
                  Seniority
                </th>
                <th scope="col" {...sortProps('work_mode')} data-sort-key="work_mode">
                  Work mode
                </th>
                <th scope="col" {...sortProps('archetype')} data-sort-key="archetype">
                  Archetype
                </th>
                <th scope="col" {...sortProps('comp')} data-sort-key="comp">
                  Comp
                </th>
                <th scope="col" {...sortProps('loc')} data-sort-key="loc">
                  Location
                </th>
                {/* Two date columns: 'Posted' = true posting date ('—' when
                  unknown) leads; 'Added' = added/scan date (every row)
                  follows. Both sortable; the Posted sort sinks unknowns to
                  the bottom. */}
                <th
                  scope="col"
                  {...sortProps('posted')}
                  data-sort-key="posted"
                  title="Date the offer was originally posted (when the source reported it)"
                >
                  Posted
                </th>
                <th
                  scope="col"
                  {...sortProps('date')}
                  data-sort-key="date"
                  title="Date the offer was added to the tracker"
                >
                  Added
                </th>
                <th scope="col" className="col-kebab">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {query.isPending && !query.data ? (
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} rowIdx={i} />
                ))}
              </tbody>
            ) : (
              <OffersTable
                rows={rows}
                totalCount={totalCount}
                setupMissing={setupMissing}
                tableRef={tableRef}
                wrapRef={wrapRef}
              />
            )}
          </table>
        </div>
      </div>
      {/* Anti-flash boot: applies saved column widths + clip/edge fades
          during HTML parse, before paint/hydration. The script is a static
          string we author; the localStorage it reads is validated inside it
          (see table-boot.ts). Rendered only for server-generated markup —
          see useIsServerRendered above. */}
      {isServerRendered && (
        <script dangerouslySetInnerHTML={{ __html: tableBootScript(COL_WIDTHS_KEY) }} />
      )}

      <BatchActionBar />
      <OffersDrawer />
    </>
  );
}

interface TablePageProps {
  initialData?: ApplicationsResponse;
  setupMissing?: OnboardingMissing[];
}

export function TablePage({ initialData, setupMissing }: TablePageProps = {}) {
  // useSearchParams() lives inside TablePageInner. After Phase 1 the route is
  // no longer force-dynamic; the explicit <Suspense> boundary in
  // app/table/page.tsx covers the useSearchParams() requirement.
  return <TablePageInner initialData={initialData} setupMissing={setupMissing} />;
}
