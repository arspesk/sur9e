import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  applySort,
  COMP_MAX,
  DEFAULTS,
  parseCompBounds,
} from '@/features/table/table-filtering';
import type { ApplicationRow } from '@/features/table/table-types';

const rows: ApplicationRow[] = [
  {
    num: 2,
    date: '2026-05-02',
    company: 'Beta',
    role: 'Designer',
    score: '2.5/5',
    status: 'screened',
    pdf: '',
    reportPath: null,
    notes: 'remote',
    seniority: 'Senior',
    work_mode: 'Remote',
  },
  {
    num: 1,
    date: '2026-05-01',
    company: 'Acme',
    role: 'Engineer',
    score: '4.5/5',
    status: 'evaluated',
    pdf: '',
    reportPath: null,
    notes: 'hybrid',
    seniority: 'Mid',
    work_mode: 'On-site',
  },
];

describe('table filtering', () => {
  it('filters by query', () => {
    const result = applyFilters(rows, { ...DEFAULTS, q: 'engineer' });
    expect(result.map(row => row.company)).toEqual(['Acme']);
  });

  it('filters by seniority (multi-select membership)', () => {
    const result = applyFilters(rows, { ...DEFAULTS, seniority: ['Mid'] });
    expect(result.map(row => row.company)).toEqual(['Acme']);
  });

  it('filters by work_mode (multi-select membership)', () => {
    const result = applyFilters(rows, { ...DEFAULTS, work_mode: ['Remote'] });
    expect(result.map(row => row.company)).toEqual(['Beta']);
  });

  it('an empty seniority/work_mode selection imposes no constraint', () => {
    const result = applyFilters(rows, { ...DEFAULTS, seniority: [], work_mode: [] });
    expect(result).toHaveLength(2);
  });

  it('sorts by score descending without mutating input', () => {
    const result = applySort(rows, { key: 'score', dir: 'desc' });
    expect(result.map(row => row.num)).toEqual([1, 2]);
    expect(rows.map(row => row.num)).toEqual([2, 1]);
  });

  it('sorts by seniority progression (Junior→Principal), not alphabetically', () => {
    // Mid (#1) ranks before Senior (#2) ascending.
    const asc = applySort(rows, { key: 'seniority', dir: 'asc' });
    expect(asc.map(r => r.num)).toEqual([1, 2]);
    const desc = applySort(rows, { key: 'seniority', dir: 'desc' });
    expect(desc.map(r => r.num)).toEqual([2, 1]);
  });

  it('sorts by work_mode order (Remote→On-site)', () => {
    // Remote (#2) ranks before On-site (#1) ascending.
    const asc = applySort(rows, { key: 'work_mode', dir: 'asc' });
    expect(asc.map(r => r.num)).toEqual([2, 1]);
  });

  describe('posted sort', () => {
    // 4 rows: two with posted (out of order), two without (missing group).
    // Missing rows carry distinct added dates so the desc fallback is testable.
    const postedRows: ApplicationRow[] = [
      { ...rows[0], num: 10, date: '2026-05-01', posted: '2026-05-20' },
      { ...rows[0], num: 11, date: '2026-05-02', posted: '2026-06-05' },
      { ...rows[0], num: 12, date: '2026-05-03', posted: undefined },
      { ...rows[0], num: 13, date: '2026-06-01', posted: undefined },
    ];

    it('asc: posted dates ascend, rows without posted sink to the bottom', () => {
      const result = applySort(postedRows, { key: 'posted', dir: 'asc' });
      expect(result.slice(0, 2).map(r => r.num)).toEqual([10, 11]);
      expect(result.slice(2).every(r => !r.posted)).toBe(true);
    });

    it('desc: posted dates descend, rows without posted STILL sink (unknown ≠ oldest)', () => {
      const result = applySort(postedRows, { key: 'posted', dir: 'desc' });
      expect(result.slice(0, 2).map(r => r.num)).toEqual([11, 10]);
      expect(result.slice(2).every(r => !r.posted)).toBe(true);
    });

    it('orders the missing group by added date desc in both directions (stable tail)', () => {
      // #13 (added 2026-06-01) before #12 (added 2026-05-03), asc and desc.
      const asc = applySort(postedRows, { key: 'posted', dir: 'asc' });
      expect(asc.slice(2).map(r => r.num)).toEqual([13, 12]);
      const desc = applySort(postedRows, { key: 'posted', dir: 'desc' });
      expect(desc.slice(2).map(r => r.num)).toEqual([13, 12]);
    });

    it('does not mutate the input', () => {
      applySort(postedRows, { key: 'posted', dir: 'asc' });
      expect(postedRows.map(r => r.num)).toEqual([10, 11, 12, 13]);
    });
  });

  it('sorts by status funnel order with the title-case statuses the API returns', () => {
    // The tracker stores title-case cells ('Screened', 'Discarded'); the sort
    // must normalize before ranking against the lowercase STATUS_ORDER —
    // a regression here made the Status header sort a silent no-op.
    const titleCased = rows.map((row, i) => ({
      ...row,
      status: ['Discarded', 'Screened'][i] ?? row.status,
    }));
    const asc = applySort(titleCased, { key: 'status', dir: 'asc' });
    expect(asc.map(r => r.status)).toEqual(['Screened', 'Discarded']);
    const desc = applySort(titleCased, { key: 'status', dir: 'desc' });
    expect(desc.map(r => r.status)).toEqual(['Discarded', 'Screened']);
  });
});

describe('parseCompBounds', () => {
  it('parses a $K range', () => {
    expect(parseCompBounds('$130K-$160K (+ equity)')).toEqual({ min: 130, max: 160 });
  });
  it('normalizes full-dollar amounts to $K', () => {
    expect(parseCompBounds('$130,000 - $160,000')).toEqual({ min: 130, max: 160 });
  });
  it('scales millions to $K', () => {
    expect(parseCompBounds('$1.2M')).toEqual({ min: 1200, max: 1200 });
  });
  it('treats a trailing + as an open-ended max', () => {
    expect(parseCompBounds('$200K+')).toEqual({ min: 200, max: null });
  });
  it('returns nulls when there is no usable number', () => {
    expect(parseCompBounds('Competitive')).toEqual({ min: null, max: null });
    expect(parseCompBounds('—')).toEqual({ min: null, max: null });
    expect(parseCompBounds(null)).toEqual({ min: null, max: null });
  });
  it('treats hourly rates as unparseable (not $K) so they stay visible', () => {
    expect(parseCompBounds('$95/hr')).toEqual({ min: null, max: null });
    expect(parseCompBounds('$45 / hour')).toEqual({ min: null, max: null });
  });
});

describe('table filtering — salary (comp range)', () => {
  const compRow = (num: number, company: string, comp: string): ApplicationRow => ({
    ...rows[0],
    num,
    company,
    role: 'r',
    score: '4/5',
    status: 'screened',
    comp,
  });
  const compRows: ApplicationRow[] = [
    compRow(1, 'Low', '$90K-$110K'),
    compRow(2, 'Mid', '$140K-$170K'),
    compRow(3, 'High', '$300K+'),
    compRow(4, 'NoComp', 'Competitive'),
  ];

  it('default comp range keeps every row, including no-comp', () => {
    expect(applyFilters(compRows, { ...DEFAULTS }).map(r => r.company)).toEqual([
      'Low',
      'Mid',
      'High',
      'NoComp',
    ]);
  });

  it('a raised floor keeps overlapping bands and drops bands entirely below + no-comp rows', () => {
    // min $150K: Low ($90-110K) is entirely below → out; NoComp can't satisfy a
    // real floor → out; Mid ($140-170K) overlaps; High ($300K+) is above.
    const out = applyFilters(compRows, { ...DEFAULTS, comp: { min: 150, max: COMP_MAX } });
    expect(out.map(r => r.company)).toEqual(['Mid', 'High']);
  });

  it('a lowered ceiling drops bands entirely above it', () => {
    // max $200K (below the cap): High ($300K+) entirely above → out; others stay.
    const out = applyFilters(compRows, { ...DEFAULTS, comp: { min: 0, max: 200 } });
    expect(out.map(r => r.company)).toEqual(['Low', 'Mid', 'NoComp']);
  });

  it('max at the cap means no upper limit (a $300K+ role passes)', () => {
    const out = applyFilters(compRows, { ...DEFAULTS, comp: { min: 250, max: COMP_MAX } });
    expect(out.map(r => r.company)).toEqual(['High']);
  });
});
