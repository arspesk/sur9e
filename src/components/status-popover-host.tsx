'use client';

/**
 * components/status-popover-host.tsx
 *
 * Renders the <StatusPopover> when useStatusPopoverStore has a target.
 * Mounted once in app/layout.tsx — every consumer (drawer header, report
 * hero pill, board card pill, etc.) just calls
 * useStatusPopoverStore.getState().show(...) and this host takes care of
 * positioning + the PATCH on pick.
 *
 * Status picks go through interceptStatusPick so the pill behaves exactly
 * like the kanban drag: picking "evaluated" persists the status first, then
 * opens an optional evaluation follow-up. Every other transition is a plain
 * PATCH.
 */

import { useToastStore } from '@/components/toast/toast-store';
import { useUpdateApplicationStatus } from '@/hooks/use-applications';
import { interceptStatusPick } from '@/lib/status-transitions';
import { useDrawerStore } from '@/stores/drawer-store';
import { useModalStore } from '@/stores/modal-store';
import { useStatusPopoverStore } from '@/stores/status-popover-store';
import { StatusPopover } from './status-popover';

export function StatusPopoverHost() {
  const open = useStatusPopoverStore(s => s.open);
  const close = useStatusPopoverStore(s => s.close);
  const closeDrawer = useDrawerStore(s => s.closeDrawer);
  const pushToast = useToastStore(s => s.push);
  const openModal = useModalStore(s => s.open);
  const { mutate: updateStatus } = useUpdateApplicationStatus();

  if (!open) return null;

  const anchorRef = { current: open.anchor };

  return (
    <StatusPopover
      currentStatus={open.currentStatus}
      anchorRef={anchorRef as React.RefObject<HTMLElement>}
      onClose={close}
      onPick={status => {
        const num = open.num;
        close();
        // Picking a status commits the change and is the user's "done with
        // this card" signal — close the offer drawer too (no-op when it isn't
        // open, e.g. the table row pill or report hero). This keeps the board
        // static on a status change: with the drawer closed, the kanban
        // column's scroll-into-view effect (board-column.tsx) can't fire and
        // yank the board to the destination column. Same behavior in table.
        closeDrawer();
        const intercept = interceptStatusPick(open.currentStatus, status);
        if (intercept.kind === 'blocked') {
          pushToast('info', `#${num} ${intercept.message}`);
          return;
        }
        if (intercept.kind === 'evaluate-modal') {
          updateStatus(
            { num, status: 'evaluated' },
            {
              onSuccess: () => {
                pushToast('success', `#${num} → evaluated`);
                openModal('evaluate', { num, statusFollowup: true });
              },
            },
          );
          return;
        }
        // Failure toast comes from useUpdateApplicationStatus's hook-level
        // onError (shared with the table pill path) — adding one here would
        // double-toast.
        updateStatus(
          { num, status },
          {
            onSuccess: () => pushToast('success', `#${num} → ${status}`),
          },
        );
      }}
    />
  );
}
