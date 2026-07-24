'use client';

// Offers autocomplete for '@' in the composer — the slash popover's sibling:
// same listbox/option a11y contract, same mousedown-preventDefault focus
// trick. Data comes from useApplications in the composer; this file is the
// pure filter + presentational list.

import { useRef } from 'react';
import { StatusPill } from '@/components/domain/status-pill';
import type { ApplicationRow } from '@/features/table/table-types';
import { useActiveOptionScroll } from '@/hooks/use-active-option-scroll';

export interface MentionItem {
  num: number;
  company: string;
  role: string;
  status: string;
}

const MAX_ITEMS = 50;

/** Case-insensitive substring match over company / role / num (with or
 * without a leading '#'). Most recent offers (highest num) first. */
export function filterMentionItems(rows: ApplicationRow[], filter: string): MentionItem[] {
  const f = filter.trim().toLowerCase().replace(/^#/, '');
  const items = [...rows]
    .sort((a, b) => b.num - a.num)
    .map(r => ({ num: r.num, company: r.company, role: r.role, status: r.status }));
  if (!f) return items.slice(0, MAX_ITEMS);
  return items
    .filter(
      i =>
        i.company.toLowerCase().includes(f) ||
        i.role.toLowerCase().includes(f) ||
        String(i.num).includes(f),
    )
    .slice(0, MAX_ITEMS);
}

/** Stable option id shared with the composer's aria-activedescendant. */
export function mentionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`;
}

export function MentionPopover({
  items,
  activeIndex,
  onSelect,
  listboxId,
}: {
  items: MentionItem[];
  activeIndex: number;
  onSelect: (item: MentionItem) => void;
  listboxId: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useActiveOptionScroll(listRef, activeIndex);
  return (
    <div ref={listRef} className="chat-mention" role="listbox" aria-label="Offers" id={listboxId}>
      {items.map((item, i) => (
        <button
          key={item.num}
          type="button"
          role="option"
          id={mentionOptionId(listboxId, i)}
          aria-selected={i === activeIndex}
          className="chat-mention__item"
          data-active={i === activeIndex ? 'true' : undefined}
          onMouseDown={e => e.preventDefault()} /* keep textarea focus */
          onClick={() => onSelect(item)}
        >
          <span className="chat-mention__name">
            {item.company} — {item.role}
          </span>
          <span className="chat-mention__meta">
            <StatusPill status={item.status} />
            <span className="chat-mention__num">#{item.num}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
