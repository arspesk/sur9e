'use client';

import { useRef } from 'react';
import { useActiveOptionScroll } from '@/hooks/use-active-option-scroll';
import { CHAT_DISCOVERABLE_MODES } from '@/lib/modes/catalog';

export interface SlashItem {
  command: string;
  hint?: string;
  description: string;
}

const MODE_HINTS: Readonly<Record<string, string>> = {
  apply: '<num>',
  'cover-letter': '<num>',
  'evaluate-offer': '<url-or-num>',
  evaluate: '<num>',
  'interview-prep': '<num>',
  latex: '<num>',
  negotiate: '<num>',
  'reach-out': '<num>',
  research: '<num>',
  screen: '<url-or-num>',
  'screen-evaluate': '<url-or-num>',
  'tailor-cv': '<num>',
};

/** Discovery is generated from the same catalog used by MCP and the chat
 * prompt, so adding or reclassifying a mode cannot leave slash commands stale. */
export const SLASH_ITEMS: SlashItem[] = CHAT_DISCOVERABLE_MODES.map(mode => ({
  command: mode.id,
  hint: MODE_HINTS[mode.id],
  description: mode.description,
}));

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
