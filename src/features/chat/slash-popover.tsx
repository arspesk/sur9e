'use client';

import { useRef } from 'react';
import { useActiveOptionScroll } from '@/hooks/use-active-option-scroll';

export interface SlashItem {
  command: string;
  hint?: string;
  description: string;
}

/** The 8 interactive chat modes + job commands (spec §2 v1 list). Hardcoded
 * by design — the backend routes modes from message text; this list only
 * powers discovery. Keep provider-neutral, one line each. */
export const SLASH_ITEMS: SlashItem[] = [
  { command: 'enrich', description: 'Strengthen your CV through a guided interview' },
  { command: 'offers', description: 'Compare your active offers side by side' },
  { command: 'tracker', description: 'Ask about application statuses and history' },
  { command: 'patterns', description: 'Analyze rejection patterns and targeting' },
  { command: 'follow-up', description: 'Review follow-up cadence for open applications' },
  { command: 'process-queue', description: 'Process pending saved job URLs' },
  { command: 'training', description: 'Evaluate a course or certification' },
  { command: 'project', description: 'Evaluate a portfolio project idea' },
  { command: 'evaluate', hint: '<num>', description: 'Run a deep evaluation for an offer' },
  { command: 'screen', hint: '<url>', description: 'Screen a job posting URL' },
  { command: 'research', hint: '<num>', description: 'Research the company behind an offer' },
  { command: 'scan', description: 'Scan portals and job boards for new offers' },
];

/** Prefix matches first, then substring matches — stable within each tier. */
export function filterSlashItems(filter: string): SlashItem[] {
  const f = filter.toLowerCase();
  if (!f) return SLASH_ITEMS;
  const prefix = SLASH_ITEMS.filter(i => i.command.startsWith(f));
  const substr = SLASH_ITEMS.filter(i => !i.command.startsWith(f) && i.command.includes(f));
  return [...prefix, ...substr];
}

/** Stable id for a listbox option, shared with the composer so its textarea
 * can point `aria-activedescendant` at the highlighted option. */
export function slashOptionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`;
}

export function SlashPopover({
  items,
  activeIndex,
  onSelect,
  listboxId,
}: {
  items: SlashItem[];
  activeIndex: number;
  onSelect: (command: string) => void;
  /** Id shared with the composer's textarea (aria-controls / aria-activedescendant). */
  listboxId: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useActiveOptionScroll(listRef, activeIndex);
  return (
    <div ref={listRef} className="chat-slash" role="listbox" aria-label="Chat modes" id={listboxId}>
      {items.map((item, i) => (
        <button
          key={item.command}
          type="button"
          role="option"
          id={slashOptionId(listboxId, i)}
          aria-selected={i === activeIndex}
          className="chat-slash__item"
          data-active={i === activeIndex ? 'true' : undefined}
          onMouseDown={e => e.preventDefault()} /* keep textarea focus */
          onClick={() => onSelect(item.command)}
        >
          <span className="chat-slash__cmd">
            /{item.command}
            {item.hint ? ` ${item.hint}` : ''}
          </span>
          <span className="chat-slash__desc">{item.description}</span>
        </button>
      ))}
    </div>
  );
}
