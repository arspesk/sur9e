'use client';

/* features/table/drawer/kebab-menu.tsx
 *
 * Drawer kebab — the ⋮ button on the drawer chrome. This
 * mirrors the full report's kebab (features/report/components/overflow-menu.tsx)
 * so the two surfaces offer the same actions, PLUS the drawer-only items
 * (Open full report, Close).
 *
 * Positioning + outside-click + Escape live in the shared KebabActionsMenu
 * primitive (components/domain/kebab-actions-menu.tsx); this file builds the
 * items array + wires the handlers.
 *
 * Items (top → bottom, dividers mirror overflow-menu.tsx):
 *   1. Open job posting (disabled if no url)
 *   2. Copy share link
 *   — divider —
 *   3. (status-gated) Apply / Follow up  — via interactiveModesFor; group
 *      + its divider omitted entirely when empty
 *   — divider —
 *   4. Print
 *   — divider —
 *   5. Delete (danger)
 *
 * This list is now IDENTICAL to overflow-menu.tsx (the full-report kebab) —
 * the kebab-parity invariant. The drawer-only "Open full report" + "Close"
 * moved OUT to inline icons in the nav row, and "Back to offers" is absent
 * (the drawer already lives on /offers, and the full report surfaces it as
 * its own inline icon).
 */

import { ExternalLink, Link2, MessageCircle, NotebookPen, Printer, Trash2 } from 'lucide-react';
import { useDeleteConfirmStore } from '@/components/delete-confirm-modal';
import { KebabActionsMenu, type KebabItem } from '@/components/domain/kebab-actions-menu';
import { useToastStore } from '@/components/toast/toast-store';
import { interactiveModesFor } from '@/features/report/report-kebab-config';
import type { ReportR } from '@/features/report/report-types';
import { useDeleteApplication } from '@/hooks/use-applications';
import { useDrawerStore } from '@/stores/drawer-store';
import { useModalStore } from '@/stores/modal-store';

interface KebabMenuProps {
  // KebabMenu uses r.num + r.url + r.company only. ReportR is the single
  // source of truth across /report and the drawer.
  r: ReportR;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function KebabMenu({ r, triggerRef, onClose }: KebabMenuProps) {
  const closeDrawer = useDrawerStore(s => s.closeDrawer);
  const confirmDelete = useDeleteConfirmStore(s => s.confirm);
  const pushToast = useToastStore(s => s.push);
  const openModal = useModalStore(s => s.open);
  const { mutate: deleteApp } = useDeleteApplication();

  const hasUrl = !!r.url;

  function handleOpenPosting() {
    if (hasUrl && r.url) window.open(r.url, '_blank', 'noopener,noreferrer');
  }

  async function handleCopyShare() {
    // Copy the REPORT link, not location.href — in the drawer the page URL is
    // /offers, so location.href would share the table, not this offer's report.
    try {
      const reportUrl = `${location.origin}/report/${encodeURIComponent(String(r.num))}`;
      await navigator.clipboard.writeText(reportUrl);
      pushToast('success', 'Share link copied');
    } catch {
      pushToast('danger', 'Could not copy link');
    }
  }

  function handlePrint() {
    // rAF→rAF lets React commit + the browser paint settle (menu close)
    // before window.print captures the page — otherwise the popover would
    // land in the print preview. Matches overflow-menu.tsx.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  async function handleDelete() {
    const ok = await confirmDelete({
      num: r.num,
      company: r.company || undefined,
    });
    if (!ok) return;
    deleteApp(
      { num: r.num },
      {
        onSuccess: () => {
          pushToast('success', `Deleted #${r.num}`);
          closeDrawer();
        },
        onError: err => {
          pushToast('danger', err instanceof Error ? err.message : 'Delete failed');
        },
      },
    );
  }

  const interactives = interactiveModesFor(r);
  const items: KebabItem[] = [
    {
      label: 'Open job posting',
      icon: <ExternalLink size={16} strokeWidth={1.8} />,
      disabled: !hasUrl,
      onClick: handleOpenPosting,
    },
    {
      label: 'Copy share link',
      icon: <Link2 size={16} strokeWidth={1.8} />,
      onClick: handleCopyShare,
    },
  ];

  if (interactives.length > 0) {
    items.push({ divider: true, label: '' });
    if (interactives.includes('apply')) {
      items.push({
        label: 'Apply',
        icon: <NotebookPen size={16} strokeWidth={1.8} />,
        onClick: () => openModal('apply', { num: r.num }),
      });
    }
    if (interactives.includes('follow-up')) {
      items.push({
        label: 'Follow up',
        icon: <MessageCircle size={16} strokeWidth={1.8} />,
        onClick: () => openModal('followup', { num: r.num }),
      });
    }
  }

  items.push(
    { divider: true, label: '' },
    {
      label: 'Print',
      icon: <Printer size={16} strokeWidth={1.8} />,
      onClick: handlePrint,
    },
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
      triggerRef={triggerRef}
      onClose={onClose}
      ariaLabel="Drawer actions"
    />
  );
}
