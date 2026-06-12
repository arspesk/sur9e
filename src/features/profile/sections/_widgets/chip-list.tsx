'use client';

// Pure widget: takes string[] values + add/remove callbacks. Sections
// wire it through rhf via Controller (or the ControlledChipList wrapper).

import { useState } from 'react';
import { HelperText, Input } from '@/components/primitives';

export interface ChipListProps {
  path: string;
  values: string[];
  inputId: string;
  inputPlaceholder: string;
  hint?: string;
  onAdd: (val: string) => void;
  onRemove: (idx: number) => void;
}

export function ChipList({
  path,
  values,
  inputId,
  inputPlaceholder,
  hint,
  onAdd,
  onRemove,
}: ChipListProps) {
  const [draft, setDraft] = useState('');
  return (
    <>
      <div className="form-chips" data-chiplist={path} aria-live="polite">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="form-chip">
            {v}{' '}
            <button
              type="button"
              className="form-chip__remove"
              data-chip-remove={i}
              aria-label={`Remove ${v}`}
              onClick={() => onRemove(i)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <Input
        className="form-chip-add"
        id={inputId}
        data-chiplist-add={path}
        placeholder={inputPlaceholder}
        autoComplete="off"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const val = draft.trim();
          if (!val) return;
          onAdd(val);
          setDraft('');
        }}
      />
      <HelperText>{hint}</HelperText>
    </>
  );
}
