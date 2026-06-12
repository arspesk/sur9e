'use client';

// Trello-style horizontal-scrolling kanban board.
//
// Ported 1:1 from legacy pipeline.html renderBoard() (lines 1341-1358) and
// wireDnD() (lines 1454-1526). Native HTML5 drag-and-drop — no library
// installation needed. PATCHes /api/applications/[num] on drop.

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useToastStore } from '@/components/toast/toast-store';
import type { ApplicationRow } from '@/features/table/table-types';
import { interceptStatusPick } from '@/lib/status-transitions';
import { updateApplicationStatusAction } from '@/server/actions/applications';
import { useModalStore } from '@/stores/modal-store';
import { useSelectionStore } from '@/stores/selection-store';
import { BoardColumn } from './board-column';
import { COLUMNS, type ColumnKey } from './board-types';

interface BoardProps {
  rows: ApplicationRow[];
  // Status filter: when non-empty, only these column keys render. Empty =
  // show all. Matches legacy state.status semantics (line 1345-1351).
  statusFilter: readonly string[];
  // Whether any filter is active — switches an empty column's copy from the
  // neutral "yet" to "match your filters".
  filtersActive: boolean;
  // Hash-filter highlight: dim columns NOT matching this key. Legacy lines
  // 1671-1679 — used for /pipeline.html#status=evaluated deep-links.
  dimOtherKey: string | null;
  onCardClick: (num: number) => void;
  onCardDoubleClick: (num: number) => void;
  onCardActionsClick: (e: React.MouseEvent<HTMLButtonElement>, num: number) => void;
  // Serialized filter/sort state — per-column window expansion resets when
  // it changes (see board-column.tsx).
  resetKey: string;
}

export function Board({
  rows,
  statusFilter,
  filtersActive,
  dimOtherKey,
  onCardClick,
  onCardDoubleClick,
  onCardActionsClick,
  resetKey,
}: BoardProps) {
  const queryClient = useQueryClient();
  const push = useToastStore(s => s.push);
  const openModal = useModalStore(s => s.open);

  const draggingNumRef = useRef<number | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Pipeline shares the table's selection store so column-title
  // "select all" + the batch action bar play with the same set.
  const selectedNums = useSelectionStore(s => s.selected);
  const setAllSelection = useSelectionStore(s => s.setAll);
  // Pending status changes shown immediately; on mutation success we
  // invalidate and let the canonical data win.
  const [optimisticStatus, setOptimisticStatus] = useState<Map<number, string>>(new Map());

  const effectiveRows = useMemo(() => {
    if (optimisticStatus.size === 0) return rows;
    return rows.map(r => {
      const o = optimisticStatus.get(r.num);
      return o ? { ...r, status: o } : r;
    });
  }, [rows, optimisticStatus]);

  // Lowercase before grouping so a stray "Applied" (title-cased by the
  // API) lands in the right column.
  const rowsByStatus = useMemo(() => {
    const m = new Map<string, ApplicationRow[]>();
    for (const col of COLUMNS) m.set(col.key, []);
    for (const r of effectiveRows) {
      const k = (r.status || '').toLowerCase();
      const list = m.get(k);
      if (list) list.push(r);
    }
    return m;
  }, [effectiveRows]);

  const visibleColumns = useMemo(() => {
    if (!statusFilter || statusFilter.length === 0) return COLUMNS;
    const allowed = new Set(statusFilter);
    return COLUMNS.filter(c => allowed.has(c.key));
  }, [statusFilter]);

  // Click a column title to toggle: if every num in the column is
  // selected, deselect them all; else add them all to the current set.
  const handleTitleClick = useCallback(
    (statusKey: string) => {
      const inColumn = rowsByStatus.get(statusKey) ?? [];
      if (inColumn.length === 0) return;
      const nums = inColumn.map(r => r.num);
      const allSelected = nums.every(n => selectedNums.has(n));
      if (allSelected) {
        // Remove just these — keep everything else.
        setAllSelection(Array.from(selectedNums).filter(n => !nums.includes(n)));
      } else {
        setAllSelection([...Array.from(selectedNums), ...nums]);
      }
    },
    [rowsByStatus, selectedNums, setAllSelection],
  );

  const handleCardDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, num: number) => {
    draggingNumRef.current = num;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    // Add .dragging class via dataset — element already has data-num so the
    // CSS rule `.card.dragging` would only kick in if we toggled className.
    (e.currentTarget as HTMLElement).classList.add('dragging');
  }, []);

  const handleCardDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).classList.remove('dragging');
    draggingNumRef.current = null;
    setDragOverKey(null);
  }, []);

  const handleColumnDragOver = useCallback((_e: React.DragEvent<HTMLDivElement>) => {
    // .preventDefault() is already called on the column wrapper to allow drop.
    // We compute dragOverKey from the target column by walking up — simplest
    // is to delegate that work to onColumnDrop's enclosing column. Mark the
    // currently hovered column via the closest ancestor's data-status.
    const tgt = _e.currentTarget as HTMLElement;
    const k = tgt.dataset.status || null;
    setDragOverKey(k);
  }, []);

  const handleColumnDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the column itself, not a child. relatedTarget
    // null means cursor left the window; otherwise check containment.
    const next = e.relatedTarget as Node | null;
    const col = e.currentTarget as HTMLElement;
    if (!next || !col.contains(next)) setDragOverKey(null);
  }, []);

  const handleColumnDrop = useCallback(
    async (_e: React.DragEvent<HTMLDivElement>, newStatus: ColumnKey) => {
      setDragOverKey(null);
      const num = draggingNumRef.current;
      draggingNumRef.current = null;
      if (num == null) return;
      const row = effectiveRows.find(r => r.num === num);
      if (!row) return;
      const prevStatus = (row.status || '').toLowerCase();
      if (prevStatus === newStatus) return;

      // Optimistic PATCH with revert-on-failure — shared by the plain-pick
      // path and the evaluate modal's "Set status only" choice.
      const patchStatus = async (status: ColumnKey) => {
        setOptimisticStatus(m => new Map(m).set(num, status));
        try {
          await updateApplicationStatusAction({ num, status });
          // Refetch — drops our optimistic entry on next render. Invalidate
          // both 'applications' (table/board) and 'report' (open report
          // page) so neither surface keeps a stale status.
          await queryClient.invalidateQueries({ queryKey: ['applications'] });
          await queryClient.invalidateQueries({ queryKey: ['report'] });
        } catch (err) {
          push('danger', err instanceof Error ? err.message : 'Failed to update status');
        } finally {
          setOptimisticStatus(m => {
            const next = new Map(m);
            next.delete(num);
            return next;
          });
        }
      };

      // Shared per-offer transition rules (same module drives the status
      // pill popovers in the table / drawer / report hero): any → evaluated
      // opens the evaluate confirm modal, which offers "Run evaluation"
      // (flip + spawn the eval job) and "Set status only" (plain flip, no
      // job). Return early — the PATCH below would race the modal's own.
      const intercept = interceptStatusPick(prevStatus, newStatus);
      if (intercept.kind === 'blocked') {
        push('info', `#${num} ${intercept.message}`);
        return;
      }
      if (intercept.kind === 'evaluate-modal') {
        openModal('evaluate', {
          num,
          patchToEvaluated: true,
          onStatusOnly: () => void patchStatus(newStatus),
        });
        return;
      }

      await patchStatus(newStatus);
    },
    [effectiveRows, push, queryClient],
  );

  // Card click delegates to parent (the page wires the drawer + dblclick → /report).
  const onCardClickInternal = useCallback(
    (num: number) => {
      onCardClick(num);
    },
    [onCardClick],
  );

  const onCardDoubleClickInternal = useCallback(
    (num: number) => {
      onCardDoubleClick(num);
    },
    [onCardDoubleClick],
  );

  return (
    <div className="board-wrap">
      <div className="board variant-dense" id="board">
        {visibleColumns.map(col => {
          const items = rowsByStatus.get(col.key) ?? [];
          const nums = items.map(r => r.num);
          const allInColumnSelected = nums.length > 0 && nums.every(n => selectedNums.has(n));
          return (
            <BoardColumn
              key={col.key}
              column={col}
              items={items}
              selectedNums={selectedNums}
              allInColumnSelected={allInColumnSelected}
              onTitleClick={handleTitleClick}
              onCardClick={onCardClickInternal}
              onCardDoubleClick={onCardDoubleClickInternal}
              onCardActionsClick={onCardActionsClick}
              onCardDragStart={handleCardDragStart}
              onCardDragEnd={handleCardDragEnd}
              onColumnDragOver={handleColumnDragOver}
              onColumnDragLeave={handleColumnDragLeave}
              onColumnDrop={handleColumnDrop}
              isDragOver={dragOverKey === col.key}
              dimmed={dimOtherKey != null && dimOtherKey !== col.key}
              filtersActive={filtersActive}
              // Discarded is terminal housekeeping, not work-in-progress — it
              // routinely dwarfs the rest of the board (486 of 552 cards at
              // last census), so it collapses to a count stub by default.
              collapsible={col.key === 'discarded'}
              resetKey={resetKey}
            />
          );
        })}
      </div>
    </div>
  );
}

export type { ApplicationRow };
