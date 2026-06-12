'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Chip } from '@/components/primitives';
import type { TableFilterState } from './table-filtering';
import { getActivePills } from './table-url-state';

interface FilterPillsProps {
  filters: TableFilterState;
  onChange: Dispatch<SetStateAction<TableFilterState>>;
}

export function FilterPills({ filters, onChange }: FilterPillsProps) {
  const pills = getActivePills(filters);
  if (pills.length === 0) return null;

  return (
    <div className="active-pills" aria-label="Active filters">
      {pills.map(pill => (
        <Chip
          key={pill.key}
          interactive
          className="chip--filter"
          data-pill-key={pill.key}
          aria-label={`Remove filter: ${pill.label}`}
          onClick={() =>
            onChange(
              current =>
                ({
                  ...current,
                  ...pill.reset,
                }) as TableFilterState,
            )
          }
        >
          {pill.label}
          <span aria-hidden="true" className="x">
            ×
          </span>
        </Chip>
      ))}
    </div>
  );
}
