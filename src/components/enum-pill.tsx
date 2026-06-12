'use client';
import { useRef, useState } from 'react';
import { type FieldOption, FieldPopover } from '@/components/field-popover';
import { useUpdateReportField } from '@/hooks/use-applications';
import { cn } from '@/lib/cn';

interface EnumPillProps {
  num: number;
  field: string; // 'archetype' | 'seniority' | 'work_mode' | 'legitimacy'
  value: string;
  options: FieldOption[];
  placeholder?: string; // shown when value is empty, e.g. 'Set seniority'
}

export function EnumPill({ num, field, value, options, placeholder }: EnumPillProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const update = useUpdateReportField();
  return (
    <>
      <button
        type="button"
        ref={ref}
        // drawer-status-trigger supplies the same chevron (::after triangle)
        // and hover-background treatment as the status pill, so every chip
        // looks + behaves identically.
        className={cn('pill', 'pill-enum', 'drawer-status-trigger')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
      >
        {value || placeholder || `Set ${field.replace(/_/g, ' ')}`}
      </button>
      {open && (
        <FieldPopover
          current={value}
          options={options}
          anchorRef={ref}
          ariaLabel={`Change ${field.replace(/_/g, ' ')}`}
          onPick={v => {
            update.mutate({ num, field, value: v });
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
