'use client';

import Link from 'next/link';
import { useOptimistic, useRef, useState, useTransition } from 'react';
import { CompanyAvatar } from '@/components/domain/company-avatar';
import { scoreLevel } from '@/components/domain/score-chip';
import { StatusPill } from '@/components/domain/status-pill';
import { EnumPill } from '@/components/enum-pill';
import { InlineTextEdit } from '@/components/inline-text-edit';
import { StatusPopover } from '@/components/status-popover';
import { useToastStore } from '@/components/toast/toast-store';
import { useUpdateApplicationStatus } from '@/hooks/use-applications';
import { useJobLock } from '@/hooks/use-job-lock';
import { useProfileQuery } from '@/hooks/use-profile';
import type { ApplicationStatus } from '@/lib/schemas/applications';
// Type-only import — erased at compile time, so the node:fs dependency of
// the server module never reaches the client bundle.
import type { OnboardingMissing } from '@/lib/server/onboarding-status';
import { VALID_SENIORITY, VALID_WORK_MODE } from '@/lib/server/report-schema';
import { interceptStatusPick } from '@/lib/status-transitions';
import { useDrawerStore } from '@/stores/drawer-store';
import { useModalStore } from '@/stores/modal-store';
import { useSelectionStore } from '@/stores/selection-store';
import { fmtDate } from '../report/report-types';
// Empty-state colSpan — derived from the shared column definitions
// (table-columns.ts), the same source the loading skeleton and the
// drift-guard test use, so it can't fall out of sync with the thead in
// table-page.tsx.
import { useTableKeyboard } from './hooks/use-table-keyboard';
import { useTableVirtualizer } from './hooks/use-table-virtualizer';
import { TABLE_COLUMN_COUNT } from './table-columns';
import { TableRowActions } from './table-row-actions';
import type { ApplicationRow } from './table-types';
import { sliceVirtualRows, spacerHeights } from './virtual-rows';

interface OffersTableProps {
  rows: ApplicationRow[];
  totalCount?: number;
  /**
   * First-run preflight (computed server-side by the RSC page): which
   * personalization files are missing. When the table is empty AND setup is
   * incomplete, the empty state points at onboarding instead of offering a
   * screen-job CTA that would hard-fail without cv.md.
   */
  setupMissing?: OnboardingMissing[];
  /** The <table> — used to measure the tbody offset within the scrollport (scrollMargin). */
  tableRef: React.RefObject<HTMLTableElement | null>;
  /** The `.table-wrap` scroll container — the virtualizer's scroll element. */
  wrapRef: React.RefObject<HTMLDivElement | null>;
}

// Client-side mirror of the labels in lib/server/onboarding-status.ts —
// kept local because importing the server module's values would pull
// node:fs into the client bundle.
const SETUP_MISSING_LABEL: Record<OnboardingMissing, string> = {
  cv: 'your CV',
  profile: 'your profile',
};

interface StatusPopoverState {
  num: number;
  status: string;
}

// setOptimistic MUST be called inside startTransition — TanStack's
// `mutate()` does not auto-wrap, and calling setOptimistic outside a
// transition throws in React 19. The wrapper in handleStatusPick /
// handleDelete keeps the optimistic update + mutation kickoff in the
// same transition so cache invalidation eventually resets us to the
// real server value (no manual rollback needed on success).
type OptimisticAction =
  | { type: 'status'; num: number; status: ApplicationStatus }
  | { type: 'delete'; num: number };

function optimisticReducer(current: ApplicationRow[], action: OptimisticAction): ApplicationRow[] {
  switch (action.type) {
    case 'status':
      return current.map(row => (row.num === action.num ? { ...row, status: action.status } : row));
    case 'delete':
      return current.filter(row => row.num !== action.num);
  }
}

export function OffersTable({
  rows,
  totalCount = 0,
  setupMissing,
  tableRef,
  wrapRef,
}: OffersTableProps) {
  const has = useSelectionStore(s => s.has);
  const toggle = useSelectionStore(s => s.toggle);
  const setAll = useSelectionStore(s => s.setAll);
  const clear = useSelectionStore(s => s.clear);
  const { openDrawer } = useDrawerStore();
  const openModal = useModalStore(s => s.open);
  const { mutate: updateStatus } = useUpdateApplicationStatus();
  const pushToast = useToastStore(s => s.push);
  const { lockedNums } = useJobLock();
  const { data: profile } = useProfileQuery();

  // Archetype options for the inline EnumPill: profile target-role archetype
  // names plus an explicit 'Off-target' escape hatch (mirrors the report hero).
  const archetypeOptions = [
    ...(profile?.target_roles?.archetypes ?? [])
      .map(a => a.name)
      .filter((n): n is string => Boolean(n))
      .map(n => ({ key: n, label: n })),
    { key: 'Off-target', label: 'Off-target' },
  ];

  // useOptimistic reconciles automatically when `rows` (the passthrough)
  // gets a fresh array reference from the parent — that happens on every
  // refetch because `normalizeApplications` returns a new array.
  const [optimisticRows, applyOptimistic] = useOptimistic(rows, optimisticReducer);
  const [, startTransition] = useTransition();

  const [statusPopover, setStatusPopover] = useState<StatusPopoverState | null>(null);
  const statusTriggerRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Windowed rendering — only rows in or near the viewport mount; spacer
  // rows preserve scrollbar geometry. Everything below stays keyed by
  // row.num (selection, drawer order, optimistic updates), so the window
  // is purely a render optimization.
  const { virtualizer, measureRowRef, scrollMargin } = useTableVirtualizer({
    count: optimisticRows.length,
    tableRef,
    wrapRef,
    getItemKey: index => optimisticRows[index]?.num ?? index,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const mountedRows = sliceVirtualRows(optimisticRows, virtualItems);
  const spacers = spacerHeights(virtualItems, virtualizer.getTotalSize(), scrollMargin);

  // Arrow/page keyboard navigation across (possibly unmounted) rows.
  const { getRowKeyDown } = useTableKeyboard({
    scrollToIndex: index => virtualizer.scrollToIndex(index),
    rowCount: optimisticRows.length,
  });

  const allSelected = optimisticRows.length > 0 && optimisticRows.every(row => has(row.num));

  function handleSelectAll() {
    if (allSelected) clear();
    else setAll(optimisticRows.map(row => row.num));
  }

  // Snapshot the visible row order so drawer prev/next walks the same
  // sort/filter result the user clicked into — not raw applications.md
  // row order. Re-derived per render; openDrawer copies it into the store.
  const orderedNums = optimisticRows.map(row => row.num);

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, row: ApplicationRow) {
    const target = e.target as HTMLElement;
    if (target.closest('.pill, button, input, .row-actions, .status-popover, [role="menu"]')) {
      return;
    }
    openDrawer(row.num, orderedNums);
  }

  function handleStatusClick(e: React.MouseEvent<HTMLButtonElement>, row: ApplicationRow) {
    e.stopPropagation();
    setStatusPopover(current =>
      current?.num === row.num ? null : { num: row.num, status: row.status },
    );
  }

  function handleStatusPick(num: number, newStatus: ApplicationStatus) {
    setStatusPopover(null);
    // Wrap optimistic update + mutation in a single transition so React 19
    // accepts the setOptimistic call. TanStack's `mutate` is fire-and-forget
    // here — onError pops a toast via the host hook; on success the
    // ['applications'] invalidation triggers a refetch + auto-reconcile.
    const patchStatus = (status: ApplicationStatus) =>
      startTransition(() => {
        applyOptimistic({ type: 'status', num, status });
        updateStatus({ num, status });
      });
    // Same rules as the kanban drag (interceptStatusPick): picking
    // "evaluated" opens the evaluate confirm modal, which offers "Run
    // evaluation" (PATCH + spawn the eval job) and "Set status only" (plain
    // PATCH, no job). Every other transition flips the pill directly.
    const row = optimisticRows.find(r => r.num === num);
    const intercept = interceptStatusPick(row?.status, newStatus);
    if (intercept.kind === 'blocked') {
      pushToast('info', `#${num} ${intercept.message}`);
      return;
    }
    if (intercept.kind === 'evaluate-modal') {
      openModal('evaluate', {
        num,
        patchToEvaluated: true,
        onStatusOnly: () => patchStatus(newStatus),
      });
      return;
    }
    patchStatus(newStatus);
  }

  if (optimisticRows.length === 0) {
    const isEmpty = totalCount === 0;
    const needsSetup = isEmpty && setupMissing != null && setupMissing.length > 0;
    return (
      <tbody id="tableBody">
        <tr>
          <td colSpan={TABLE_COLUMN_COUNT} className="offers-empty-cell" role="status">
            {/* The cell spans the full 13-column table, which is wider than
                the scrollport at desktop/tablet — without this wrapper the
                copy + CTA render past the right edge of .table-wrap. Sticky
                with symmetric left/right insets (percentages resolve against
                the scrollport) pins the box centered in the VISIBLE scroll
                area; on mobile, where the table fits the viewport, both
                insets collapse to 0 and the box lays out naturally. Inline
                because the 220px is half the box width below — keep in sync. */}
            <div
              style={{
                position: 'sticky',
                left: 'max(0px, calc(50% - 220px))',
                right: 'max(0px, calc(50% - 220px))',
                width: 'min(440px, 100%)',
                // Table cells inherit white-space: nowrap (table-inline.css)
                // — without this the copy renders as one clipped line.
                whiteSpace: 'normal',
              }}
            >
              {needsSetup ? (
                // First-run dead-end guard: without cv.md / profile.yml every
                // screen job hard-fails (batch/screen.mjs exits 1), so point
                // at onboarding instead of offering a doomed "+ Add offer".
                <>
                  <p style={{ margin: '0 0 12px' }}>
                    Welcome! Before sur9e can screen offers it needs{' '}
                    {setupMissing.map(key => SETUP_MISSING_LABEL[key]).join(' and ')}. Open your AI
                    coding agent in the sur9e folder and it will walk you through setup — or fill in
                    the basics yourself on the Profile page.
                  </p>
                  <Link href="/profile" className="btn btn-primary">
                    Finish setup on Profile
                  </Link>
                </>
              ) : isEmpty ? (
                <>
                  <p style={{ margin: '0 0 12px' }}>
                    No offers tracked yet. Paste a job-posting URL to add your first one, or run{' '}
                    <code>/sur9e scan</code> in your terminal to pull from configured portals.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => openModal('screen')}
                  >
                    + Add offer
                  </button>
                </>
              ) : (
                <>No offers match your filters.</>
              )}
            </div>
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody id="tableBody">
      {/* Spacer rows stand in for the unmounted rows above/below the window
          so the scrollbar reflects the full filtered set. aria-hidden: they
          carry no content and screen readers should walk row to row. */}
      {spacers.top > 0 ? (
        <tr className="virt-spacer" aria-hidden="true">
          <td colSpan={TABLE_COLUMN_COUNT} style={{ height: spacers.top }} />
        </tr>
      ) : null}
      {virtualItems.map((item, i) => {
        const row = mountedRows[i];
        if (!row) return null;
        const isSelected = has(row.num);
        const triggerRef = { current: statusTriggerRefs.current.get(row.num) ?? null };

        return (
          <tr
            key={row.num}
            ref={measureRowRef}
            className="anim-enter offers-row"
            data-num={row.num}
            data-index={item.index}
            aria-rowindex={item.index + 2}
            data-selected={isSelected ? 'true' : 'false'}
            tabIndex={0}
            aria-description="Press Enter to open the report"
            onClick={e => handleRowClick(e, row)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (e.target !== e.currentTarget) return;
                e.preventDefault();
                openDrawer(row.num, orderedNums);
                return;
              }
              getRowKeyDown(item.index)(e);
            }}
          >
            <td
              className="col-select"
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
            >
              <input
                type="checkbox"
                className="row-select"
                data-num={row.num}
                aria-label={`Select row ${row.num}`}
                checked={isSelected}
                onChange={() => toggle(row.num)}
              />
            </td>
            {/* suppressHydrationWarning on the data cells: the anti-flash boot
                script (table-boot.ts) pre-marks clipped cells with .is-clipped
                before hydration so the fade doesn't pop in; React 19 would
                otherwise log a className mismatch for every pre-marked cell.
                useCellClipFade re-marks everything at mount, so the boot pass
                is purely cosmetic. */}
            <td suppressHydrationWarning className="col-num offers-num">
              {row.num}
            </td>
            <td className="col-co">
              <span className="cell-co">
                <CompanyAvatar company={row.company} logoUrl={row.company_logo} className="tmk" />
                <span suppressHydrationWarning className="cell-co__name">
                  {row.company}
                </span>
              </span>
            </td>
            <td suppressHydrationWarning className="col-role">
              {row.role}
            </td>
            <td suppressHydrationWarning className="col-status">
              <StatusPill
                ref={el => {
                  if (el) statusTriggerRefs.current.set(row.num, el);
                  else statusTriggerRefs.current.delete(row.num);
                }}
                status={row.status}
                interactive
                className="drawer-status-trigger"
                data-num={row.num}
                aria-haspopup="menu"
                aria-expanded={statusPopover?.num === row.num}
                aria-disabled={lockedNums.has(row.num) ? 'true' : 'false'}
                disabled={lockedNums.has(row.num)}
                onClick={e => handleStatusClick(e, row)}
              />
              {statusPopover?.num === row.num ? (
                <StatusPopover
                  currentStatus={row.status}
                  anchorRef={triggerRef}
                  onPick={newStatus => handleStatusPick(row.num, newStatus)}
                  onClose={() => setStatusPopover(null)}
                />
              ) : null}
            </td>
            <td suppressHydrationWarning className="col-score">
              {(() => {
                // Distinguish "not yet scored" (N/A → NaN) from a genuine 0.0.
                // Mirrors ScoreChip: NaN renders a muted placeholder rather
                // than coercing to 0.0 + a low-tier color.
                const numeric = Number.parseFloat(String(row.score));
                if (Number.isNaN(numeric)) {
                  // Bare `.score-num` (no high/mid/low color) inherits the
                  // cell's muted text, giving a neutral placeholder distinct
                  // from a real low-tier 0.0.
                  return (
                    <span className="score-num" aria-label="Not yet scored">
                      —
                    </span>
                  );
                }
                return (
                  <span className={`score-num ${scoreLevel(numeric)}`}>{numeric.toFixed(1)}</span>
                );
              })()}
            </td>
            {/* Order after Score: dropdown fields (seniority, mode, archetype)
                → inline-edit fields (comp, location) → date. */}
            <td suppressHydrationWarning className="col-seniority">
              <EnumPill
                num={row.num}
                field="seniority"
                value={row.seniority ?? ''}
                options={VALID_SENIORITY.map(s => ({ key: s, label: s }))}
                placeholder="—"
              />
            </td>
            <td suppressHydrationWarning className="col-mode">
              <EnumPill
                num={row.num}
                field="work_mode"
                value={row.work_mode ?? ''}
                options={VALID_WORK_MODE.map(s => ({ key: s, label: s }))}
                placeholder="—"
              />
            </td>
            <td suppressHydrationWarning className="col-arch">
              <EnumPill
                num={row.num}
                field="archetype"
                value={row.archetype ?? ''}
                options={archetypeOptions}
                placeholder="—"
              />
            </td>
            <td suppressHydrationWarning className="col-comp">
              <InlineTextEdit
                num={row.num}
                field="comp"
                value={row.comp ?? ''}
                ariaLabel="Edit comp"
                placeholder="—"
              />
            </td>
            <td suppressHydrationWarning className="col-loc">
              <InlineTextEdit
                num={row.num}
                field="location"
                value={row.loc ?? ''}
                ariaLabel="Edit location"
                placeholder="—"
              />
            </td>
            {/* Posting date and added (scan) date are separate sortable
                columns — see OFFERS_TABLE_COLUMNS. Posted leads ('—' when
                the source never reported one); Added follows. */}
            <td suppressHydrationWarning className="col-posted">
              {row.posted ? fmtDate(row.posted) : '—'}
            </td>
            <td suppressHydrationWarning className="col-date">
              {fmtDate(row.date)}
            </td>
            <td
              className="col-kebab"
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
            >
              <TableRowActions row={row} lockedNums={lockedNums} />
            </td>
          </tr>
        );
      })}
      {spacers.bottom > 0 ? (
        <tr className="virt-spacer" aria-hidden="true">
          <td colSpan={TABLE_COLUMN_COUNT} style={{ height: spacers.bottom }} />
        </tr>
      ) : null}
    </tbody>
  );
}
