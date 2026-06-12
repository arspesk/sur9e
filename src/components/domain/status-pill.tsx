'use client';

import type {
  ButtonHTMLAttributes,
  ForwardRefExoticComponent,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
  Ref,
  RefAttributes,
} from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export type StatusKey =
  | 'screened'
  | 'evaluated'
  | 'applied'
  | 'responded'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'discarded';

const STATUS_LABELS: Record<string, string> = {
  screened: 'Screened',
  evaluated: 'Evaluated',
  applied: 'Applied',
  responded: 'Responded',
  interview: 'Interview',
  // Display-label only — the underlying status value stays 'offer'. "Offer
  // received" disambiguates the pipeline stage from tracked postings, which
  // the UI also calls "offers".
  offer: 'Offer received',
  rejected: 'Rejected',
  discarded: 'Discarded',
  skip: 'Discarded',
};

/**
 * Canonical display label for a raw status value ("skip" → "Discarded",
 * known statuses → Title case, unknown values capitalized as-is). Single
 * source of truth shared by the pill below and non-pill surfaces (report
 * hero) so the skip→Discarded rule can't drift.
 */
export function statusLabel(status: string): string {
  if (!status) return '';
  const key = status.toLowerCase().replace(/\s+/g, '');
  return STATUS_LABELS[key] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

// Common props shared between the static (<span>) and interactive (<button>)
// renderings.
interface BaseStatusPillProps {
  status: string;
  className?: string;
}

// Static span — non-interactive label display.
type StaticStatusPillProps = BaseStatusPillProps &
  Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'children'> & {
    interactive?: false;
  };

// Interactive button — clickable trigger (e.g. status popover). Forwards
// every <button> attribute including onClick, disabled, aria-*, data-*.
type InteractiveStatusPillProps = BaseStatusPillProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children' | 'type'> & {
    interactive: true;
    onClick?: MouseEventHandler<HTMLButtonElement>;
  };

export type StatusPillProps = StaticStatusPillProps | InteractiveStatusPillProps;

function pillContent(status: string): { label: string; pillClass: string } {
  // Row data ships mixed-case ("Interview", "Applied") but the canonical
  // CSS rules and STATUS_LABELS keys are lowercased. Normalize both for
  // the label lookup and the class suffix so the legacy
  // `pill-${status.toLowerCase()}` behaviour is preserved.
  const key = (status || '').toLowerCase().replace(/\s+/g, '');
  const label = statusLabel(status);
  const pillClass = `pill-${key === 'skip' ? 'discarded' : key}`;
  return { label, pillClass };
}

function StatusPillImpl(
  props: StatusPillProps,
  ref: Ref<HTMLButtonElement | HTMLSpanElement>,
): ReactNode {
  const { status, className } = props;
  const { label, pillClass } = pillContent(status);

  if (props.interactive) {
    const { interactive: _interactive, status: _status, className: _cn, ...rest } = props;
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        className={cn('pill', pillClass, className)}
        {...rest}
      >
        <span className="dot" aria-hidden="true" />
        {label}
      </button>
    );
  }

  const { interactive: _interactive, status: _status, className: _cn, ...rest } = props;
  return (
    <span ref={ref as Ref<HTMLSpanElement>} className={cn('pill', pillClass, className)} {...rest}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

// Discriminated-union ref typing so consumers get the correct element type
// based on the `interactive` prop without resorting to runtime casts at the
// call site. The static branch refs an HTMLSpanElement; the interactive
// branch refs an HTMLButtonElement.
type StatusPillComponent = ForwardRefExoticComponent<
  | (Omit<StaticStatusPillProps, 'ref'> & RefAttributes<HTMLSpanElement>)
  | (Omit<InteractiveStatusPillProps, 'ref'> & RefAttributes<HTMLButtonElement>)
>;

export const StatusPill = forwardRef(StatusPillImpl) as StatusPillComponent;
(StatusPill as { displayName?: string }).displayName = 'StatusPill';
