'use client';

/* features/table/table-row-actions.tsx
 *
 * Per-row kebab in the offers table. Renders the vertical-dots trigger and opens
 * the shared full row menu (links · apply/follow-up · AI generation · delete)
 * via <RowActionsMenu> in ./row-actions-menu.tsx.
 *
 * lockedNums is currently unused — kept on props for parent compatibility;
 * locked-row affordances move in with the job-runner wiring.
 */

import { EllipsisVertical } from 'lucide-react';
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
        icon={<EllipsisVertical className="menu-dots-icon" aria-hidden="true" />}
      />
      <RowActionsMenu open={menuOpen} anchorRef={kebabRef} row={row} onClose={closeMenu} />
    </>
  );
}
