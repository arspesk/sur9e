'use client';
import { useState } from 'react';
import { useUpdateReportField } from '@/hooks/use-applications';

interface InlineTextEditProps {
  num: number;
  field: string; // 'location' | 'comp'
  value: string;
  ariaLabel: string;
  placeholder?: string;
}

export function InlineTextEdit({ num, field, value, ariaLabel, placeholder }: InlineTextEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const update = useUpdateReportField();

  if (!editing) {
    return (
      <button
        type="button"
        className="inline-edit"
        aria-label={ariaLabel}
        onClick={e => {
          e.stopPropagation();
          setDraft(value);
          setEditing(true);
        }}
      >
        {value || <span className="inline-edit__empty">{placeholder ?? '—'}</span>}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    if (draft !== value) update.mutate({ num, field, value: draft });
  };
  return (
    <input
      className="inline-edit__input"
      autoFocus
      value={draft}
      aria-label={ariaLabel}
      onClick={e => e.stopPropagation()}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
