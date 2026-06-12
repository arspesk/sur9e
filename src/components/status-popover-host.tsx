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
 * like the kanban drag: picking "evaluated" opens the evaluate confirm
 * modal, which offers BOTH "Run evaluation" (PATCH + spawn the eval job)
 * and "Set status only" (plain PATCH, no job) — the user chooses. Every
 * other transition is a plain PATCH.
 */

import { useToastStore } from '@/components/toast/toast-store';
import { useUpdateApplicationStatus } from '@/hooks/use-applications';
import { interceptStatusPick } from '@/lib/status-transitions';
import { useModalStore } from '@/stores/modal-store';
import { useStatusPopoverStore } from '@/stores/status-popover-store';
import { StatusPopover } from './status-popover';

export function StatusPopoverHost() {
  const open = useStatusPopoverStore(s => s.open);
  const close = useStatusPopoverStore(s => s.close);
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
        const intercept = interceptStatusPick(open.currentStatus, status);
        if (intercept.kind === 'blocked') {
          pushToast('info', `#${num} ${intercept.message}`);
          return;
        }
        if (intercept.kind === 'evaluate-modal') {
          // patchToEvaluated → "Run evaluation" flips status then spawns the
          // job; onStatusOnly → "Set status only" just flips to evaluated
          // with no job (same plain PATCH the hook toasts on error).
          openModal('evaluate', {
            num,
            patchToEvaluated: true,
            onStatusOnly: () =>
              updateStatus(
                { num, status: 'evaluated' },
                { onSuccess: () => pushToast('success', `#${num} → evaluated`) },
              ),
          });
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
