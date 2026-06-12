'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Shuffle, Sparkles, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useDeleteConfirmStore } from '@/components/delete-confirm-modal';
import { KebabActionsMenu, type KebabItem } from '@/components/domain/kebab-actions-menu';
import { ModeIcon } from '@/components/domain/mode-icon';
import { StatusPopover } from '@/components/status-popover';
import { useToastStore } from '@/components/toast/toast-store';
import {
  GENERATOR_MODES,
  MODE_MODAL_KEY,
  MODE_REGISTRY,
} from '@/features/report/report-toolbar-config';
import { useApplications } from '@/hooks/use-applications';
import type { ApplicationStatus } from '@/lib/schemas/applications';
import {
  batchDeleteApplicationsAction,
  batchUpdateApplicationStatusAction,
} from '@/server/actions/applications';
import { useModalStore } from '@/stores/modal-store';
import { useSelectionStore } from '@/stores/selection-store';

export function BatchActionBar() {
  const selected = useSelectionStore(s => s.selected);
  const clear = useSelectionStore(s => s.clear);
  const count = selected.size;

  const { data } = useApplications();
  const queryClient = useQueryClient();
  const push = useToastStore(s => s.push);
  const confirmDelete = useDeleteConfirmStore(s => s.confirm);
  const openModal = useModalStore(s => s.open);

  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  const statusBtnRef = useRef<HTMLButtonElement>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const generateBtnRef = useRef<HTMLButtonElement>(null);

  if (count === 0) return null;

  const rows = data?.entries ?? [];
  const selectedNums = Array.from(selected);

  // If selection statuses vary the user just picks fresh; the popover's
  // "is-current" highlight uses the first row's status as a hint.
  const firstNum = selectedNums[0];
  const firstRow = rows.find(r => r.num === firstNum);
  const firstStatus = (firstRow?.status || '').toLowerCase();

  async function applyBulkStatus(nums: number[], newStatus: ApplicationStatus) {
    // Per-row failures are reported in the action's result; a rejected action
    // (network drop, payload parse error) would otherwise vanish as an
    // unhandled rejection — toast it and keep the selection so the user can
    // retry.
    let ok: number;
    let failed: number;
    try {
      ({ ok, failed } = await batchUpdateApplicationStatusAction({
        nums,
        status: newStatus,
      }));
    } catch (err) {
      push('danger', err instanceof Error ? err.message : 'Bulk status update failed');
      return;
    }
    if (failed === 0) push('success', `Updated ${ok} offer${ok === 1 ? '' : 's'}`);
    else if (ok === 0) push('danger', `Failed to update ${failed} offers`);
    else push('info', `Updated ${ok} offers (${failed} failed)`);
    clear();
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['status-log'] });
  }

  async function handleBulkStatus(newStatus: ApplicationStatus) {
    setStatusPopoverOpen(false);
    // Re-read live selection — user may have toggled rows mid-popover.
    const liveNums = Array.from(useSelectionStore.getState().selected);
    if (!liveNums.length) return;

    // Bulk variant of the interceptStatusPick rule (single-row surfaces call
    // it directly — see status-popover-host.tsx). Selection statuses vary
    // per row, so instead of comparing prev/next we key off the pick alone:
    // 'evaluated' routes through the evaluate confirm modal. Confirming
    // spawns real evaluation jobs (nums[] fan-out); the modal's explicit
    // "Set status only" button applies the plain bulk PATCH without running
    // anything. Cancel / Escape / overlay-click abort entirely — they're
    // indistinguishable from an accidental dismiss, so they must not write.
    if (newStatus === 'evaluated') {
      openModal('evaluate', {
        count: liveNums.length,
        nums: liveNums,
        onStatusOnly: () => void applyBulkStatus(liveNums, 'evaluated'),
      });
      return;
    }

    await applyBulkStatus(liveNums, newStatus);
  }

  async function handleBulkDelete() {
    const liveNums = Array.from(useSelectionStore.getState().selected);
    if (!liveNums.length) return;
    const ok = await confirmDelete({ count: liveNums.length });
    if (!ok) return;
    // Same rejection guard as handleBulkStatus — keep the selection on a
    // thrown action so the user can retry.
    let deleted: number;
    let failed: number;
    try {
      ({ ok: deleted, failed } = await batchDeleteApplicationsAction({ nums: liveNums }));
    } catch (err) {
      push('danger', err instanceof Error ? err.message : 'Bulk delete failed');
      return;
    }
    if (failed === 0) push('success', `Deleted ${deleted} offer${deleted === 1 ? '' : 's'}`);
    else if (deleted === 0) push('danger', `Failed to delete ${failed} offers`);
    else push('info', `Deleted ${deleted} offers (${failed} failed)`);
    clear();
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['status-log'] });
  }

  return (
    <aside
      id="batch-action-bar"
      className="batch-action-bar on"
      role="toolbar"
      aria-label="Batch actions"
    >
      <span className="batch-action-bar__count" id="batch-count">
        {count} selected
      </span>

      <button
        ref={statusBtnRef}
        type="button"
        className="batch-action-bar__btn"
        data-action="status"
        aria-haspopup="menu"
        aria-expanded={statusPopoverOpen}
        onClick={() => setStatusPopoverOpen(v => !v)}
      >
        <Shuffle size={16} strokeWidth={1.8} aria-hidden="true" />
        Change status
        <ChevronDown className="batch-action-bar__chev" aria-hidden="true" strokeWidth={2} />
      </button>

      <button
        ref={generateBtnRef}
        type="button"
        className="batch-action-bar__btn"
        data-action="generate"
        aria-haspopup="menu"
        aria-expanded={generateOpen}
        onClick={() => setGenerateOpen(v => !v)}
      >
        <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
        Generate
        <ChevronDown className="batch-action-bar__chev" aria-hidden="true" strokeWidth={2} />
      </button>

      <button
        type="button"
        className="batch-action-bar__btn batch-action-bar__btn--danger"
        data-action="delete"
        onClick={handleBulkDelete}
      >
        <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
        Delete
      </button>

      <button
        type="button"
        className="batch-action-bar__btn batch-action-bar__clear"
        data-action="clear"
        onClick={clear}
      >
        Clear
      </button>

      {statusPopoverOpen ? (
        <StatusPopover
          currentStatus={firstStatus}
          anchorRef={statusBtnRef}
          onPick={handleBulkStatus}
          onClose={() => setStatusPopoverOpen(false)}
          disabledStatuses={[]}
          // The bar is position:fixed — document-coord positioning would
          // leave the popover behind on scroll.
          strategy="fixed"
          className="popover-above-bottom-bar"
        />
      ) : null}
      {generateOpen ? (
        <KebabActionsMenu
          ariaLabel="Generate for selection"
          triggerRef={generateBtnRef}
          onClose={() => setGenerateOpen(false)}
          className="popover-above-bottom-bar"
          items={GENERATOR_MODES.map((mode): KebabItem => {
            const meta = MODE_REGISTRY[mode];
            return {
              label: meta?.label ?? mode,
              icon: meta ? <ModeIcon svg={meta.icon} /> : undefined,
              onClick: () => {
                setGenerateOpen(false);
                const liveNums = Array.from(useSelectionStore.getState().selected);
                if (!liveNums.length) return;
                openModal(MODE_MODAL_KEY[mode], { count: liveNums.length, nums: liveNums });
              },
            };
          })}
        />
      ) : null}
    </aside>
  );
}
