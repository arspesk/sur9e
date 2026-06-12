'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/primitives';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useProfileQuery } from '@/hooks/use-profile';
import {
  COMP_MAX,
  DEFAULTS,
  SENIORITY_ORDER,
  type TableFilterState,
  WORK_MODE_ORDER,
} from './table-filtering';

interface TableFiltersProps {
  value: TableFilterState;
  onChange: Dispatch<SetStateAction<TableFilterState>>;
  open?: boolean;
  onClose?: () => void;
}

const STATUS_OPTIONS = [
  { value: 'screened', label: 'Screened' },
  { value: 'evaluated', label: 'Evaluated' },
  { value: 'applied', label: 'Applied' },
  { value: 'responded', label: 'Responded' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer received' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'discarded', label: 'Discarded' },
];

const SORT_OPTIONS = [
  { value: 'num', label: '# (report no.)' },
  { value: 'score', label: 'Score' },
  { value: 'date', label: 'Added' },
  // True posting date — rows without one sink to the bottom in both
  // directions (see applySort in table-filtering.ts).
  { value: 'posted', label: 'Posted' },
  { value: 'company', label: 'Company' },
  { value: 'role', label: 'Role' },
  { value: 'status', label: 'Status' },
  { value: 'comp', label: 'Comp' },
  { value: 'loc', label: 'Location' },
  { value: 'archetype', label: 'Archetype' },
  { value: 'seniority', label: 'Seniority' },
  { value: 'work_mode', label: 'Work mode' },
];

const SENIORITY_OPTIONS = SENIORITY_ORDER.map(v => ({ value: v, label: v }));
const WORK_MODE_OPTIONS = WORK_MODE_ORDER.map(v => ({ value: v, label: v }));

// Multi-select checkbox filter section with the "all-checked ⇒ empty array
// (no filter)" convention shared by Status, Seniority and Work mode. Toggling
// one off when all were checked keeps the rest; checking the last one back in
// collapses to the empty (= no constraint) state.
function CheckboxFilterSection({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: { value: string; label: string }[];
  selected: string[];
  onSelect: (next: string[]) => void;
}) {
  return (
    <section className="fp-section">
      <h3>{title}</h3>
      <div className="fp-checks">
        {options.map(opt => (
          <label key={opt.value}>
            <input
              type="checkbox"
              value={opt.value}
              checked={selected.length === 0 || selected.includes(opt.value)}
              onChange={e => {
                const allChecked = selected.length === 0;
                let next: string[];
                if (allChecked) {
                  next = options.map(o => o.value).filter(v => v !== opt.value);
                } else if (e.target.checked) {
                  next = [...selected, opt.value];
                  if (next.length === options.length) next = [];
                } else {
                  next = selected.filter(v => v !== opt.value);
                }
                onSelect(next);
              }}
            />{' '}
            {opt.label}
          </label>
        ))}
      </div>
    </section>
  );
}

export function TableFilters({ value, onChange, open = false, onClose }: TableFiltersProps) {
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(panelRef, open);

  // Escape closes the panel while open. useFocusTrap only RELEASES the trap
  // on Escape (WCAG no-keyboard-trap escape hatch) — a modal role="dialog"
  // must pair it with its own Escape-to-close (mirrors screen-modal). Focus
  // returns to the Filters trigger via the trap's deactivation restore.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Archetype filter options — the SAME source as the inline-edit archetype
  // dropdown (offers-table / report hero): profile target-role names plus the
  // 'Off-target' escape hatch. Keeps the filter in lockstep with what users can
  // actually assign to an offer.
  const { data: profile } = useProfileQuery();
  const archetypeOptions = [
    ...(profile?.target_roles?.archetypes ?? [])
      .map(a => a.name)
      .filter((n): n is string => Boolean(n))
      .map(n => ({ value: n, label: n })),
    { value: 'Off-target', label: 'Off-target' },
  ];

  function handleReset() {
    onChange({ ...DEFAULTS, sort: { ...DEFAULTS.sort } });
  }

  return (
    <aside
      ref={panelRef}
      id="filter-panel"
      className={open ? 'filter-panel open' : 'filter-panel'}
      role="dialog"
      aria-label="Filters"
      aria-hidden={!open}
    >
      <div className="filter-panel__handle" aria-hidden="true"></div>
      <header className="filter-panel__header">
        <h2 className="filter-panel__title">Filters</h2>
        <button
          type="button"
          className="filter-panel__close"
          aria-label="Close filters"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="filter-panel__body">
        <section className="fp-section">
          <h3>Sort by</h3>
          <div className="fp-radios" role="radiogroup" aria-label="Sort key">
            {SORT_OPTIONS.map(opt => (
              <label key={opt.value}>
                <input
                  type="radio"
                  name="sort-key"
                  value={opt.value}
                  checked={value.sort.key === opt.value}
                  onChange={() => onChange(f => ({ ...f, sort: { ...f.sort, key: opt.value } }))}
                />{' '}
                {opt.label}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="fp-sort-dir"
            data-dir={value.sort.dir}
            aria-label="Toggle sort direction"
            onClick={() =>
              onChange(f => ({
                ...f,
                sort: { ...f.sort, dir: f.sort.dir === 'asc' ? 'desc' : 'asc' },
              }))
            }
          >
            <span aria-hidden="true">{value.sort.dir === 'asc' ? '▲' : '▼'}</span>{' '}
            {value.sort.dir === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </section>

        <section className="fp-section">
          <h3>Score range</h3>
          <div className="fp-range">
            <label>
              Min{' '}
              <input
                type="range"
                id="table-score-min"
                name="score-min"
                min="0"
                max="5"
                step="0.5"
                value={value.score.min}
                onChange={e => {
                  const lo = parseFloat(e.target.value);
                  onChange(f => ({ ...f, score: { min: lo, max: Math.max(lo, f.score.max) } }));
                }}
              />{' '}
              <output htmlFor="table-score-min">{value.score.min.toFixed(1)}</output>
            </label>
            <label>
              Max{' '}
              <input
                type="range"
                id="table-score-max"
                name="score-max"
                min="0"
                max="5"
                step="0.5"
                value={value.score.max}
                onChange={e => {
                  const hi = parseFloat(e.target.value);
                  onChange(f => ({ ...f, score: { min: Math.min(f.score.min, hi), max: hi } }));
                }}
              />{' '}
              <output htmlFor="table-score-max">{value.score.max.toFixed(1)}</output>
            </label>
          </div>
        </section>

        <section className="fp-section">
          <h3>Salary range</h3>
          <div className="fp-range">
            <label>
              Min{' '}
              <input
                type="range"
                id="table-comp-min"
                name="comp-min"
                min="0"
                max={COMP_MAX}
                step="10"
                value={value.comp.min}
                onChange={e => {
                  const lo = parseFloat(e.target.value);
                  onChange(f => ({ ...f, comp: { min: lo, max: Math.max(lo, f.comp.max) } }));
                }}
              />{' '}
              <output htmlFor="table-comp-min">${value.comp.min}K</output>
            </label>
            <label>
              Max{' '}
              <input
                type="range"
                id="table-comp-max"
                name="comp-max"
                min="0"
                max={COMP_MAX}
                step="10"
                value={value.comp.max}
                onChange={e => {
                  const hi = parseFloat(e.target.value);
                  onChange(f => ({ ...f, comp: { min: Math.min(f.comp.min, hi), max: hi } }));
                }}
              />{' '}
              <output htmlFor="table-comp-max">
                {value.comp.max >= COMP_MAX ? `$${COMP_MAX}K+` : `$${value.comp.max}K`}
              </output>
            </label>
          </div>
        </section>

        <CheckboxFilterSection
          title="Status"
          options={STATUS_OPTIONS}
          selected={value.status}
          onSelect={next => onChange(f => ({ ...f, status: next }))}
        />

        <CheckboxFilterSection
          title="Seniority"
          options={SENIORITY_OPTIONS}
          selected={value.seniority}
          onSelect={next => onChange(f => ({ ...f, seniority: next }))}
        />

        <CheckboxFilterSection
          title="Work mode"
          options={WORK_MODE_OPTIONS}
          selected={value.work_mode}
          onSelect={next => onChange(f => ({ ...f, work_mode: next }))}
        />

        <CheckboxFilterSection
          title="Archetype"
          options={archetypeOptions}
          selected={value.archetype}
          onSelect={next => onChange(f => ({ ...f, archetype: next }))}
        />

        <section className="fp-section">
          <h3>Date</h3>
          <div className="fp-radios" role="radiogroup" aria-label="Date filter">
            {[
              { value: 'all', label: 'All' },
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
              { value: '90d', label: 'Last 90 days' },
            ].map(opt => (
              <label key={opt.value}>
                <input
                  type="radio"
                  name="date"
                  value={opt.value}
                  checked={value.date === opt.value}
                  onChange={() => onChange(f => ({ ...f, date: opt.value }))}
                />{' '}
                {opt.label}
              </label>
            ))}
          </div>
        </section>
      </div>

      <footer className="filter-panel__footer">
        <Button variant="ghost" className="fp-reset" onClick={handleReset}>
          Reset all
        </Button>
        <Button variant="ghost" className="fp-reset-layout" title="Restore default column widths">
          Reset layout
        </Button>
        <Button variant="primary" className="fp-apply" onClick={onClose}>
          Apply
        </Button>
      </footer>
    </aside>
  );
}
