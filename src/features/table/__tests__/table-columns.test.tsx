// Drift guard: the loading skeleton, the hydrated table, and the shared
// column definitions (table-columns.ts) must describe the same column set.
// The live thead is rendered inline in table-page.tsx, so it is checked by
// source scan (its col-* classes are computed at runtime, but its
// data-sort-key attributes and control-column classes are literal).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OFFERS_TABLE_COLUMNS, TABLE_COLUMN_COUNT } from '../table-columns';
import { TableLoading } from '../table-loading';

// vitest runs from the repo root; import.meta.url is unreliable under the
// jsdom transform, so resolve sources from cwd.
const readSource = (file: string) =>
  readFileSync(join(process.cwd(), 'src/features/table', file), 'utf8');

describe('offers table column definitions', () => {
  it('skeleton thead renders exactly the shared column set, in order', () => {
    const { container } = render(<TableLoading />);
    const ths = [...container.querySelectorAll('thead th')];
    expect(ths.map(th => th.className)).toEqual(OFFERS_TABLE_COLUMNS.map(c => c.className));
    // Visible labels match too (col-kebab's label is sr-only but present).
    expect(ths.map(th => th.textContent)).toEqual(OFFERS_TABLE_COLUMNS.map(c => c.label));
  });

  it('skeleton rows render one td per shared column, in order', () => {
    const { container } = render(<TableLoading />);
    const firstRow = container.querySelector('tbody tr');
    const tds = [...(firstRow?.querySelectorAll('td') ?? [])];
    expect(tds.map(td => td.className)).toEqual(OFFERS_TABLE_COLUMNS.map(c => c.className));
  });

  it('matches the live thead in table-page.tsx (source scan)', () => {
    const source = readSource('table-page.tsx');
    const theadSource = source.slice(source.indexOf('<thead>'), source.indexOf('</thead>'));
    expect(theadSource.length).toBeGreaterThan(0);

    // Sortable columns: ordered data-sort-key literals must equal the shared
    // sortKey sequence.
    const liveSortKeys = [...theadSource.matchAll(/data-sort-key="([^"]+)"/g)].map(m => m[1]);
    const sharedSortKeys = OFFERS_TABLE_COLUMNS.filter(c => c.sortKey).map(c => c.sortKey);
    expect(liveSortKeys).toEqual(sharedSortKeys);

    // Control columns: select leads, kebab trails.
    expect(theadSource.indexOf('col-select')).toBeGreaterThan(-1);
    expect(theadSource.indexOf('col-kebab')).toBeGreaterThan(theadSource.indexOf('col-select'));

    // Total: sortable + the two control columns.
    expect(liveSortKeys.length + 2).toBe(TABLE_COLUMN_COUNT);
  });

  it('matches the data-row cells in offers-table.tsx (source scan)', () => {
    const source = readSource('offers-table.tsx');
    // td class literals appear in JSX order within the row map.
    const cellClasses = [...source.matchAll(/<td[^>]*className="(col-[a-z]+)/gs)].map(m => m[1]);
    expect(cellClasses).toEqual(OFFERS_TABLE_COLUMNS.map(c => c.className));
  });
});
