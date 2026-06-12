'use client';

import { statusLabel } from '@/components/domain/status-pill';
import { APPLICATION_STATUSES, type ApplicationStatus } from '@/lib/schemas/applications';
import { type FieldOption, FieldPopover } from './field-popover';

// The popover MUST be rendered as a child of document.body (via portal)
// and positioned via inline top/left from the trigger's bounding rect —
// otherwise the table cell's overflow:hidden clips it and the row's
// stacking context traps z-index.

interface StatusPopoverProps {
  currentStatus: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onPick: (status: ApplicationStatus) => void;
  onClose: () => void;
  disabledStatuses?: ApplicationStatus[];
  /** Pass 'fixed' when the anchor lives in a position:fixed container
   *  (batch action bar) — see FieldPopover. */
  strategy?: 'absolute' | 'fixed';
  /** Extra class on the portaled popover — see FieldPopover. */
  className?: string;
}

export function StatusPopover({
  currentStatus,
  anchorRef,
  onPick,
  onClose,
  disabledStatuses = [],
  strategy,
  className,
}: StatusPopoverProps) {
  // API returns status title-cased ("Discarded") but APPLICATION_STATUSES keys are lowercase.
  // Normalize so .is-current + disabled comparisons work.
  const currentKey = (currentStatus || '').toLowerCase();
  const disabledSet = new Set(disabledStatuses.map(s => s.toLowerCase()));

  const options: FieldOption[] = APPLICATION_STATUSES.map(key => ({
    key,
    // statusLabel (status-pill.tsx) is the single source of truth for status
    // display copy — keeps 'offer' → "Offer received" consistent with the pill.
    label: statusLabel(key),
    // Render each option as its colored status pill.
    pillClass: `pill-${key}`,
    // Preserve the existing rule: a status is disabled only if it's in
    // disabledStatuses AND it is NOT the currently-selected status.
    disabled: disabledSet.has(key) && key !== currentKey,
  }));

  return (
    <FieldPopover
      current={currentStatus}
      options={options}
      anchorRef={anchorRef}
      ariaLabel="Change status"
      onClose={onClose}
      onPick={key => onPick(key as ApplicationStatus)}
      strategy={strategy}
      className={className}
    />
  );
}
