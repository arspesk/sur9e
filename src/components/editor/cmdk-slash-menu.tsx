// Replacement renderer for the TipTap Suggestion plugin's popup. Items
// come from slash-registry.ts. Icon strings are SVG markup produced by
// our own code (see tiptap-icons.ts and report-toolbar-config.ts).
// Mounted via React's raw-HTML escape hatch so the inline SVG renders.
//
// Keyboard navigation (ArrowUp/Down/Enter/Tab) is handled in the
// TipTap Suggestion plugin's onKeyDown (see tiptap-slash.ts), which
// owns the active index and passes it here. We mirror that index into
// cmdk's `value` so the visible highlight follows along.

'use client';

import { Command } from 'cmdk';
import { useMemo } from 'react';
import type { SlashItem } from './slash-registry';

interface CmdkSlashMenuProps {
  query: string;
  activeIndex: number;
  onSelect: (item: SlashItem) => void;
  /**
   * Items to render. Comes from the TipTap Suggestion plugin's filtered
   * list (matchSlashItems(query, ctx) in tiptap-slash.ts) so the cmdk
   * surface stays in sync with the keyboard nav array — without this the
   * menu drifted: keyboard arrows walked the filtered list while cmdk
   * rendered the unfiltered registry, so AI generators showed up on
   * /profile even though the registry filtered them out.
   */
  items: SlashItem[];
}

export function CmdkSlashMenu({ query: _query, activeIndex, onSelect, items }: CmdkSlashMenuProps) {
  // Active item id, derived from the clamped active index. cmdk uses this
  // to render the visual highlight; arrow-key navigation is driven entirely
  // by the TipTap Suggestion plugin (cmdk's own filter/loop is disabled
  // via shouldFilter={false} and the noop onValueChange below).
  const activeId =
    items.length > 0 ? items[Math.max(0, Math.min(activeIndex, items.length - 1))].id : '';

  const grouped = useMemo(() => {
    const map = new Map<string, SlashItem[]>();
    for (const i of items) {
      const g = map.get(i.group) ?? [];
      g.push(i);
      map.set(i.group, g);
    }
    // Group display order: AI generation first (the high-value modes
    // are what the user is here for), then Basic blocks, then anything
    // else in registration order.
    const GROUP_ORDER = ['AI generation', 'Basic blocks'];
    const entries = Array.from(map.entries());
    entries.sort(([a], [b]) => {
      const ai = GROUP_ORDER.indexOf(a);
      const bi = GROUP_ORDER.indexOf(b);
      const ax = ai === -1 ? GROUP_ORDER.length : ai;
      const bx = bi === -1 ? GROUP_ORDER.length : bi;
      return ax - bx;
    });
    return entries;
  }, [items]);

  return (
    <Command
      className="be-cmdk"
      shouldFilter={false}
      loop
      value={activeId}
      onValueChange={() => {
        /* navigation controlled by tiptap-slash.ts */
      }}
    >
      <Command.List>
        {grouped.length === 0 && <Command.Empty>No matches</Command.Empty>}
        {grouped.map(([group, gItems]) => (
          <Command.Group key={group} heading={group}>
            {gItems.map(item => (
              <Command.Item key={item.id} value={item.id} onSelect={() => onSelect(item)}>
                {item.icon && (
                  <span
                    className="be-cmdk__icon"
                    // Icon SVG comes from our own icon module / toolbar config.
                    dangerouslySetInnerHTML={{ __html: item.icon }}
                  />
                )}
                <span className="be-cmdk__label">{item.label}</span>
                {item.hint && <span className="be-cmdk__hint">{item.hint}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  );
}
