'use client';

/* features/table/row-actions-menu.tsx
 *
 * Per-row (table) / per-card (kanban) actions menu, built on the shared
 * KebabActionsMenu primitive (positioning, outside-click, Escape).
 * Item groups, top → bottom:
 *   1. Open job posting · Copy share link (/report/{num})
 *   2. Apply or Follow up — same STATUS_KEBAB_ACTIONS map as the report kebab
 *   3. AI generation — all 7 generator modes, MODE_REGISTRY labels + icons,
 *      no status gating, no cost/time sub-labels
 *   4. Delete (danger)
 * Keeps the legacy `open` + `anchorRef` + `row` + `onClose` contract so
 * table-row-actions.tsx and pipeline-page.tsx need no changes.
 */

import { ExternalLink, Link2, MessageCircle, NotebookPen, Shuffle, Trash2 } from 'lucide-react';
import { useDeleteConfirmStore } from '@/components/delete-confirm-modal';
import { KebabActionsMenu, type KebabItem } from '@/components/domain/kebab-actions-menu';
import { ModeIcon } from '@/components/domain/mode-icon';
import { useToastStore } from '@/components/toast/toast-store';
import { interactiveModesForStatus } from '@/features/report/report-kebab-config';
import {
  GENERATOR_MODES,
  MODE_MODAL_KEY,
  MODE_REGISTRY,
} from '@/features/report/report-toolbar-config';
import { useDeleteApplication } from '@/hooks/use-applications';
import { useModalStore } from '@/stores/modal-store';
import { useStatusPopoverStore } from '@/stores/status-popover-store';
import type { ApplicationRow } from './table-types';

interface RowActionsMenuProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  row: ApplicationRow;
  onClose: () => void;
}

export function RowActionsMenu({ open, anchorRef, row, onClose }: RowActionsMenuProps) {
  const pushToast = useToastStore(s => s.push);
  const confirmDelete = useDeleteConfirmStore(s => s.confirm);
  const openModal = useModalStore(s => s.open);
  const showStatusPopover = useStatusPopoverStore(s => s.show);
  const { mutate: deleteApp } = useDeleteApplication();

  if (!open) return null;

  async function handleCopyShare() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/report/${row.num}`);
      pushToast('success', 'Share link copied');
    } catch {
      pushToast('danger', 'Could not copy link');
    }
  }

  async function handleDelete() {
    const ok = await confirmDelete({ num: row.num, company: row.company });
    if (!ok) return;
    deleteApp(
      { num: row.num },
      {
        onSuccess: () => pushToast('success', `Deleted #${row.num}`),
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Delete failed';
          pushToast('danger', msg);
        },
      },
    );
  }

  const items: KebabItem[] = [
    {
      label: 'Open job posting',
      icon: <ExternalLink size={16} strokeWidth={1.8} />,
      disabled: !row.url,
      onClick: () => {
        if (row.url) window.open(row.url, '_blank', 'noopener,noreferrer');
      },
    },
    {
      label: 'Copy share link',
      icon: <Link2 size={16} strokeWidth={1.8} />,
      onClick: handleCopyShare,
    },
    {
      // Keyboard path for moving a card/row to another status without the
      // mouse-only kanban drag. Reuses the shared status-popover machinery
      // (StatusPopoverHost → useUpdateApplicationStatus), anchored to the
      // kebab trigger which is still in the DOM after the menu closes.
      label: 'Change status',
      icon: <Shuffle size={16} strokeWidth={1.8} />,
      onClick: () => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        showStatusPopover({ anchor, num: row.num, currentStatus: row.status || '' });
      },
    },
  ];

  const interactives = interactiveModesForStatus(row.status || '');
  if (interactives.length > 0) {
    items.push({ divider: true, label: '' });
    if (interactives.includes('apply')) {
      items.push({
        label: 'Apply',
        icon: <NotebookPen size={16} strokeWidth={1.8} />,
        onClick: () => openModal('apply', { num: row.num }),
      });
    }
    if (interactives.includes('follow-up')) {
      items.push({
        label: 'Follow up',
        icon: <MessageCircle size={16} strokeWidth={1.8} />,
        onClick: () => openModal('followup', { num: row.num }),
      });
    }
  }

  items.push({ divider: true, label: '' });
  for (const mode of GENERATOR_MODES) {
    const meta = MODE_REGISTRY[mode];
    if (!meta) continue;
    items.push({
      label: meta.label,
      icon: <ModeIcon svg={meta.icon} />,
      // Pass the kebab trigger as returnFocus so the confirm modal restores
      // focus to it on close. The menu unmounts when the modal opens, so
      // Radix's automatic focus-restore would otherwise dump focus on <body>
      // and the keyboard user would lose their place in the table.
      onClick: () =>
        openModal(MODE_MODAL_KEY[mode], { num: row.num, returnFocus: anchorRef.current }),
    });
  }

  items.push(
    { divider: true, label: '' },
    {
      label: 'Delete offer',
      icon: <Trash2 size={16} strokeWidth={1.8} />,
      danger: true,
      onClick: handleDelete,
    },
  );

  return (
    <KebabActionsMenu
      items={items}
      triggerRef={anchorRef}
      onClose={onClose}
      ariaLabel="Row actions"
    />
  );
}
