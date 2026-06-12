'use client';

// Pure widget: takes rows + per-cell callbacks. Sections wire it through
// rhf via Controller (or the ControlledRowList wrapper).

import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/primitives';

type RowKind = 'archetype' | 'proof_point' | 'language';

// Radix Select forbids empty-string values, so we translate "" <-> NONE at
// the consumer boundary. rhf state still sees "" for cleared cells.
const NONE = '__none__';

const ARCH_LEVELS = ['junior', 'mid', 'senior', 'staff', 'principal'];
const ARCH_FITS = ['primary', 'secondary', 'adjacent'];
const LANG_PROFICIENCIES = ['native', 'full', 'professional', 'conversational', 'basic'];

function selectOptionsFor(kind: RowKind, col: string): string[] | null {
  if (kind === 'archetype' && col === 'level') return ARCH_LEVELS;
  if (kind === 'archetype' && col === 'fit') return ARCH_FITS;
  if (kind === 'language' && col === 'proficiency') return LANG_PROFICIENCIES;
  return null;
}

function titleCaseLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

export interface RowListProps<R extends Record<string, string>> {
  path: string;
  kind: RowKind;
  cols: ReadonlyArray<keyof R & string>;
  rows: R[];
  onCellChange: (idx: number, col: string, value: string) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
  addLabel: string;
}

// Placeholder text for proof_point inputs that benefit from a hint.
const PROOF_POINT_PLACEHOLDERS: Record<string, string> = {
  hero_metric: 'Hero metric — e.g. +15% lead conversion',
};

export function RowList<R extends Record<string, string>>(props: RowListProps<R>) {
  const { path, kind, cols, rows, onCellChange, onRemove, onAdd, addLabel } = props;
  const isProofPoint = kind === 'proof_point';
  return (
    <>
      <div className="form-rows" data-rowlist={path} data-cols={cols.join(',')}>
        {rows.map((row, i) => {
          if (isProofPoint) {
            // proof_point layout: two-line grid
            //   Line 1: name (2fr) | url (1fr) | remove button (auto)
            //   Line 2: hero_metric spanning full width
            const nameVal = asString(row['name']);
            const urlVal = asString(row['url']);
            const metricVal = asString(row['hero_metric']);
            return (
              <div
                className="form-row form-row--proof-point"
                data-row-idx={i}
                key={`${path}-row-${i}`}
              >
                <Input
                  className="row-cell row-cell--name"
                  data-row-col="name"
                  placeholder="Name"
                  aria-label="Name"
                  value={nameVal}
                  onChange={e => onCellChange(i, 'name', e.target.value)}
                />
                <Input
                  className="row-cell row-cell--url"
                  data-row-col="url"
                  placeholder="URL"
                  aria-label="URL"
                  value={urlVal}
                  onChange={e => onCellChange(i, 'url', e.target.value)}
                />
                <button
                  className="form-row__remove"
                  data-row-remove={i}
                  type="button"
                  aria-label="Remove row"
                  onClick={() => onRemove(i)}
                >
                  ×
                </button>
                <Input
                  className="row-cell row-cell--metric"
                  data-row-col="hero_metric"
                  placeholder={PROOF_POINT_PLACEHOLDERS['hero_metric']}
                  aria-label="Hero metric"
                  value={metricVal}
                  onChange={e => onCellChange(i, 'hero_metric', e.target.value)}
                />
              </div>
            );
          }

          return (
            <div
              className="form-row"
              data-row-idx={i}
              // Key by positional index, NOT by a cell value. Keying on
              // row.name meant typing into the name input changed the key,
              // remounting the row each keystroke → the input lost focus
              // after one character. Inputs are controlled (value from
              // rows[i][c]), so index keys stay correct across add/remove.
              key={`${path}-row-${i}`}
            >
              {cols.map(c => {
                const label = titleCaseLabel(c);
                const value = asString(row[c]);
                const sel = selectOptionsFor(kind, c);
                if (sel) {
                  return (
                    <Select
                      key={c}
                      value={value ? value : NONE}
                      onValueChange={v => onCellChange(i, c, v === NONE ? '' : v)}
                    >
                      <SelectTrigger className="row-cell" data-row-col={c} aria-label={label}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        {sel.map(v => (
                          <SelectItem key={v} value={v}>
                            {titleCaseLabel(v)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                }
                return (
                  <Input
                    key={c}
                    className="row-cell"
                    data-row-col={c}
                    placeholder={label}
                    aria-label={label}
                    value={value}
                    onChange={e => onCellChange(i, c, e.target.value)}
                  />
                );
              })}
              <button
                className="form-row__remove"
                data-row-remove={i}
                type="button"
                aria-label="Remove row"
                onClick={() => onRemove(i)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="form-row__add"
        data-rowlist-add={path}
        type="button"
        onClick={() => onAdd()}
      >
        {addLabel}
      </button>
    </>
  );
}
