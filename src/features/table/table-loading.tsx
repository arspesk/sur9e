// TableLoading — placeholder <table> with thead + 6 skeleton rows shown while
// the first /api/applications fetch is in flight. Renders the same DOM used
// by both the route-level loading.tsx (Suspense fallback) and the in-component
// query.isPending branch in table-page.tsx.
//
// The column set comes from OFFERS_TABLE_COLUMNS (table-columns.ts) — the
// same definition the drift-guard test checks against the hydrated table's
// thead in table-page.tsx — so the skeleton header can never disagree with
// the loaded header (the old hand-written 8-column thead made every header
// label jump when the 13-column table landed).
//
// Per UX rules: text bars 4px radius, status cell mirrors StatusPill (pill
// radius), score cell mirrors ScoreChip (sm radius). Cells use varied widths
// per-row for natural rhythm instead of identical bars.

import { OFFERS_TABLE_COLUMNS } from './table-columns';

export function TableLoading() {
  return (
    <div className="table-loading" aria-busy="true" aria-label="Loading offers…">
      <div className="table-wrap">
        <table className="offers">
          <thead>
            <tr>
              {OFFERS_TABLE_COLUMNS.map(col =>
                col.className === 'col-kebab' ? (
                  <th key={col.className} className={col.className}>
                    <span className="sr-only">{col.label}</span>
                  </th>
                ) : (
                  <th key={col.className} className={col.className}>
                    {col.label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} rowIdx={i} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Skeleton bar shape per column. `w` may differ for even/odd rows for a
// natural rhythm. Control columns (col-select, col-kebab) render empty cells
// and are not listed.
const BAR: Record<
  string,
  { h: number; w: number | string; wOdd?: number | string; r: number | string }
> = {
  'col-num': { h: 12, w: 32, r: 4 },
  'col-co': { h: 14, w: '78%', wOdd: '64%', r: 4 },
  'col-role': { h: 14, w: '88%', wOdd: '72%', r: 4 },
  // StatusPill mirror — pill radius
  'col-status': { h: 22, w: 76, r: 999 },
  // ScoreChip mirror
  'col-score': { h: 20, w: 36, r: 4 },
  // EnumPill mirrors (seniority / mode / archetype)
  'col-seniority': { h: 12, w: 56, r: 4 },
  'col-mode': { h: 12, w: 48, r: 4 },
  'col-arch': { h: 12, w: 88, r: 4 },
  'col-comp': { h: 12, w: 64, r: 4 },
  'col-loc': { h: 12, w: 72, wOdd: 56, r: 4 },
  'col-date': { h: 12, w: 56, r: 4 },
};

/** Single skeleton row — exported so the in-component pending branch in
 * table-page.tsx renders identical DOM. */
export function SkeletonRow({ rowIdx }: { rowIdx: number }) {
  const even = rowIdx % 2 === 0;
  return (
    <tr className="offers-skeleton-row">
      {OFFERS_TABLE_COLUMNS.map(col => {
        const bar = BAR[col.className];
        return (
          <td key={col.className} className={col.className}>
            {bar ? (
              <span
                className="sk"
                style={{
                  display: 'inline-block',
                  height: bar.h,
                  width: even ? bar.w : (bar.wOdd ?? bar.w),
                  borderRadius: bar.r,
                }}
              />
            ) : null}
          </td>
        );
      })}
    </tr>
  );
}
