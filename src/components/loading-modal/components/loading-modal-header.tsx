'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { JobSnapshot } from '../loading-modal-store';
import { fmtElapsed } from '../phases';

/** Deck navigation — prev/next arrows + "2/5" creation-order counter.
 * Present only on the FRONT card when more than one job is in the deck. */
export interface DeckNav {
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

/** Card title with a native tooltip ONLY when the text is actually
 * ellipsized — re-measured on resize since the nav cluster appearing/
 * disappearing changes the available width without a title change. */
function TruncatableTitle({ title }: { title: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // Re-measure on text change too — same box width, different overflow.
  }, [title]);
  return (
    <span ref={ref} className="loading-modal__title" title={truncated ? title : undefined}>
      {title}
    </span>
  );
}

interface LoadingModalHeaderProps {
  title: string;
  isDone: boolean;
  isError: boolean;
  collapsed: boolean;
  elapsed: number;
  /** Sub-line shown when collapsed and in-progress — the card passes the
   * same pulsing FunnyPrompt the expanded body shows, so collapsing the
   * card never downgrades the "something is happening" signal. */
  sub: React.ReactNode;
  snapshot: JobSnapshot;
  nav?: DeckNav;
  onToggleCollapse: () => void;
  onClose: () => void;
}

export function LoadingModalHeader({
  title,
  isDone,
  isError,
  collapsed,
  elapsed,
  sub,
  snapshot,
  nav,
  onToggleCollapse,
  onClose,
}: LoadingModalHeaderProps) {
  return (
    <div className="loading-modal__header-row">
      {/* Collapse/expand toggle — native button for clean a11y name (fix #28) */}
      <button
        type="button"
        className="loading-modal__header"
        aria-label={`${title}, ${collapsed ? 'collapsed' : 'expanded'}`}
        aria-expanded={!collapsed}
        onClick={onToggleCollapse}
      >
        {/* Icon spans are decorative — hidden from AT (fix #4). While the
            job is RUNNING there is no header icon — the pulsing dot lives
            next to the funny prompt in the body instead. */}
        {(isDone || isError) && (
          <span className="loading-modal__icon" aria-hidden="true">
            {isDone ? (
              <span className="loading-modal__icon-check">✓</span>
            ) : (
              <span className="loading-modal__icon-error">!</span>
            )}
          </span>
        )}
        <span className="loading-modal__title-block">
          <TruncatableTitle title={title} />
          {collapsed && !isDone && !isError && sub}
          {isError && snapshot.error && (
            <span className="loading-modal__sub">{snapshot.error}</span>
          )}
        </span>
        <span className="loading-modal__elapsed">{fmtElapsed(elapsed)}</span>
      </button>
      {/* Deck nav — siblings of the header button (not nested) for clean a11y */}
      {nav && (
        <span className="loading-modal__nav">
          <button
            type="button"
            className="loading-modal__nav-btn"
            aria-label="Previous job"
            onClick={nav.onPrev}
          >
            <ChevronLeft size={13} aria-hidden="true" />
          </button>
          <span
            className="loading-modal__nav-count"
            aria-label={`Job ${nav.position} of ${nav.total}`}
          >
            {nav.position}/{nav.total}
          </span>
          <button
            type="button"
            className="loading-modal__nav-btn"
            aria-label="Next job"
            onClick={nav.onNext}
          >
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        </span>
      )}
      {/* No collapse chevron — the whole header button toggles collapse
          (aria-expanded) and the short title leaves the row uncluttered. */}
      {/* Dismiss button is a sibling so it is NOT nested inside another button */}
      <button type="button" className="loading-modal__close" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
