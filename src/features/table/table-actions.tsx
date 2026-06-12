'use client';

/* table-actions.tsx
 *
 * Add button + ActionsMenu wiring for the table topbar.
 * Extracted from table-page.tsx to keep the orchestrator lean.
 *
 * Preserves verbatim markup from the legacy table.html Add button
 * (actions-trigger, actions-trigger__plus, actions-trigger__chev classes).
 * The parent owns selection; this component receives only `onJobAction`.
 */

import { ChevronDown } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { ActionsMenu, type ActionsMenuScope } from '@/components/domain/actions-menu';
import { Button } from '@/components/primitives';

interface TableActionsProps {
  onJobAction: (jobType: string, scope: ActionsMenuScope) => void;
}

export function TableActions({ onJobAction }: TableActionsProps) {
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const closeActionsMenu = useCallback(() => setActionsMenuOpen(false), []);

  return (
    <>
      <Button
        ref={addBtnRef}
        variant="primary"
        className="actions-trigger"
        aria-haspopup="menu"
        aria-expanded={actionsMenuOpen}
        onClick={() => setActionsMenuOpen(v => !v)}
        trailingIcon={
          <ChevronDown className="actions-trigger__chev" aria-hidden="true" strokeWidth={2} />
        }
      >
        Add
      </Button>
      <ActionsMenu
        open={actionsMenuOpen}
        anchorRef={addBtnRef}
        scope="global"
        onClose={closeActionsMenu}
        onSelect={onJobAction}
      />
    </>
  );
}
