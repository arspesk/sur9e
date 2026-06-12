'use client';

/* features/report/components/overflow-menu.tsx
 *
 * Report-level kebab menu, mounted from report-page.tsx with `r` + the
 * shared kebab triggerRef. Uses the same KebabActionsMenu primitive as the
 * drawer kebab so positioning + outside-click + Escape come for free.
 *
 * Item groups (top → bottom):
 *   1. Open job posting · Copy share link
 *   2. (status-gated) Apply · Follow up   — via STATUS_KEBAB_ACTIONS
 *   3. Print
 *   4. Delete offer (danger)
 *
 * "Back to offers" moved OUT to an inline back-arrow icon next to the meatball
 * in report-page.tsx. The remaining items are kept IDENTICAL to the
 * drawer kebab (kebab-menu.tsx) — the kebab-parity invariant.
 */

import { ExternalLink, Link2, MessageCircle, NotebookPen, Printer, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDeleteConfirmStore } from '@/components/delete-confirm-modal';
import { KebabActionsMenu, type KebabItem } from '@/components/domain/kebab-actions-menu';
import { useToastStore } from '@/components/toast/toast-store';
import { useDeleteApplication } from '@/hooks/use-applications';
import { useModalStore } from '@/stores/modal-store';
import { useOverflowMenuStore } from '@/stores/overflow-menu-store';
import { interactiveModesFor } from '../report-kebab-config';
import type { ReportR } from '../report-types';

interface OverflowMenuProps {
  r: ReportR | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

export function OverflowMenu({ r, triggerRef }: OverflowMenuProps) {
  const router = useRouter();
  const open = useOverflowMenuStore(s => s.open);
  const close = useOverflowMenuStore(s => s.close);
  const openModal = useModalStore(s => s.open);
  const push = useToastStore(s => s.push);
  const confirm = useDeleteConfirmStore(s => s.confirm);
  const del = useDeleteApplication();

  if (!open || !r) return null;
  const { num, company } = r;

  async function handleCopyShare() {
    try {
      await navigator.clipboard.writeText(location.href);
      push('success', 'Share link copied');
    } catch {
      push('danger', 'Could not copy link');
    }
  }

  function handleOpenPosting() {
    if (r?.url) window.open(r.url, '_blank', 'noopener,noreferrer');
  }

  function handlePrint() {
    // rAF→rAF lets React commit + the browser paint settle (menu close)
    // before window.print captures the page — otherwise the popover would
    // land in the print preview. Matches the legacy delegated handler.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  async function handleDelete() {
    const ok = await confirm({ num, company: company || undefined });
    if (!ok) return;
    del.mutate(
      { num },
      {
        onSuccess: () => {
          push('success', `Deleted #${num}`);
          router.push('/offers');
        },
        onError: e => push('danger', e instanceof Error ? e.message : 'Delete failed'),
      },
    );
  }

  const interactives = interactiveModesFor(r);
  const items: KebabItem[] = [
    {
      label: 'Open job posting',
      icon: <ExternalLink size={16} strokeWidth={1.8} />,
      disabled: !r.url,
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
        onClick: () => openModal('apply', { num }),
      });
    }
    if (interactives.includes('follow-up')) {
      items.push({
        label: 'Follow up',
        icon: <MessageCircle size={16} strokeWidth={1.8} />,
        onClick: () => openModal('followup', { num }),
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
      onClose={close}
      ariaLabel="Report actions"
    />
  );
}
