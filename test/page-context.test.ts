import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  describeOffersContext,
  type TableFilterState,
} from '@/features/table/table-filtering';
import { usePageContextStore } from '@/stores/page-context-store';

// ── Part 1: the page-context store ──────────────────────────────────────────

describe('page-context store', () => {
  beforeEach(() => usePageContextStore.setState({ context: null }));

  it('setContext publishes and clearContext empties the slot', () => {
    usePageContextStore.getState().setContext('report for offer #16 Otter');
    expect(usePageContextStore.getState().context).toBe('report for offer #16 Otter');
    usePageContextStore.getState().clearContext();
    expect(usePageContextStore.getState().context).toBeNull();
  });

  it('setContext(null) empties the slot (unmount / no summary)', () => {
    usePageContextStore.getState().setContext('offers table — 5 offers');
    usePageContextStore.getState().setContext(null);
    expect(usePageContextStore.getState().context).toBeNull();
  });
});

// ── Part 1: one surface's computed string (the offers table) ────────────────

const filters = (over: Partial<TableFilterState> = {}): TableFilterState => ({
  ...DEFAULTS,
  sort: { ...DEFAULTS.sort },
  score: { ...DEFAULTS.score },
  comp: { ...DEFAULTS.comp },
  status: [],
  archetype: [],
  seniority: [],
  work_mode: [],
  ...over,
});

describe('describeOffersContext', () => {
  it('bare view: count + the active (default) sort, no filter/selection clauses', () => {
    expect(describeOffersContext(filters(), 552, 0)).toBe(
      'offers table — 552 offers, sorted by score desc',
    );
  });

  it('surfaces active filters (search + status) and the current selection', () => {
    const out = describeOffersContext(
      filters({ q: 'linear', status: ['applied', 'interview'], sort: { key: 'num', dir: 'asc' } }),
      552,
      3,
    );
    expect(out).toBe(
      'offers table — 552 offers, sorted by num asc, ' +
        'filtered to search "linear", status applied/interview, 3 selected',
    );
  });

  it('describes non-default score / comp / date bands', () => {
    const out = describeOffersContext(filters({ score: { min: 3, max: 5 }, date: '30d' }), 10, 0);
    expect(out).toContain('filtered to score 3–5, date 30d');
    expect(out).not.toContain('selected');
  });
});
