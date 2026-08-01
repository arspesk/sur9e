'use client';

/* features/table/table-row-actions.tsx
 *
 * Per-row kebab in the offers table. Renders the ⋯ trigger button and opens
 * the shared full row menu (links · apply/follow-up · AI generation · delete)
 * via <RowActionsMenu> in ./row-actions-menu.tsx.
 *
 * lockedNums is currently unused — kept on props for parent compatibility;
 * locked-row affordances move in with the job-runner wiring.
 */

import { useCallback, useRef, useState } from 'react';
import { IconButton } from '@/components/primitives';
import { RowActionsMenu } from './row-actions-menu';
import type { ApplicationRow } from './table-types';

interface TableRowActionsProps {
  row: ApplicationRow;
  // Kept on the props for parent compatibility; locked-row affordances move
  // in with the job-runner wiring.
  lockedNums: Set<number>;
}

export function TableRowActions({ row, lockedNums: _lockedNums }: TableRowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const kebabRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <>
      {/* TODO: verify 44x44 mobile hit-target after
       * IconButton migration via 3-width screenshot gate. Legacy .row-actions
       * had 18px font + 44x44 padding; IconButton default size is 32x32. If
       * WCAG 2.5.5 AAA regresses, add size="lg" or a padding decoration. */}
      <IconButton
        ref={kebabRef}
        label={`Row actions for ${row.company}`}
        title="Row actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-num={row.num}
        onClick={e => {
          e.stopPropagation();
          setMenuOpen(v => !v);
        }}
        icon={
          <span aria-hidden="true" className="icon-ellipsis">
            ⋯
          </span>
        }
      />
      <RowActionsMenu open={menuOpen} anchorRef={kebabRef} row={row} onClose={closeMenu} />
    </>
  );
}
