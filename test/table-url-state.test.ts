import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '@/features/table/table-filtering';
import { getActivePills, parseURL, serializeURL } from '@/features/table/table-url-state';

const baseState = () => ({
  q: '',
  sort: { ...DEFAULTS.sort },
  score: { ...DEFAULTS.score },
  comp: { ...DEFAULTS.comp },
  status: [] as string[],
  archetype: [] as string[],
  seniority: [] as string[],
  work_mode: [] as string[],
  date: 'all',
});

describe('serializeURL', () => {
  it('returns empty string for defaults', () => {
    expect(serializeURL(baseState())).toBe('');
  });

  it('serializes q', () => {
    expect(serializeURL({ ...baseState(), q: 'hello world' })).toContain('q=hello%20world');
  });

  it('serializes sort when non-default', () => {
    const state = { ...baseState(), sort: { key: 'date', dir: 'asc' as const } };
    expect(serializeURL(state)).toContain('sort=date%3Aasc');
  });

  it('serializes score range', () => {
    expect(serializeURL({ ...baseState(), score: { min: 3, max: 5 } })).toContain('score=3-5');
  });

  it('serializes status array', () => {
    const state = { ...baseState(), status: ['applied', 'interview'] };
    expect(serializeURL(state)).toContain('status=applied%2Cinterview');
  });

  it('serializes seniority and work_mode arrays', () => {
    const state = { ...baseState(), seniority: ['Mid', 'Senior'], work_mode: ['Remote'] };
    const qs = serializeURL(state);
    expect(qs).toContain('seniority=Mid%2CSenior');
    expect(qs).toContain('work_mode=Remote');
  });
});

describe('parseURL', () => {
  it('returns defaults for empty string', () => {
    const result = parseURL('');
    expect(result.q).toBe(DEFAULTS.q);
    expect(result.sort.key).toBe(DEFAULTS.sort.key);
    expect(result.sort.dir).toBe(DEFAULTS.sort.dir);
    expect(result.score.min).toBe(DEFAULTS.score.min);
    expect(result.score.max).toBe(DEFAULTS.score.max);
    expect(result.status).toEqual([]);
    expect(result.seniority).toEqual([]);
    expect(result.work_mode).toEqual([]);
    expect(result.date).toBe('all');
  });

  it('parses q', () => {
    expect(parseURL('q=hello%20world').q).toBe('hello world');
  });

  it('parses sort', () => {
    const result = parseURL('sort=date%3Aasc');
    expect(result.sort.key).toBe('date');
    expect(result.sort.dir).toBe('asc');
  });

  it('accepts seniority and work_mode as sort keys', () => {
    expect(parseURL('sort=seniority%3Aasc').sort.key).toBe('seniority');
    expect(parseURL('sort=work_mode%3Adesc').sort.key).toBe('work_mode');
  });

  it('accepts posted as a sort key and round-trips it', () => {
    expect(parseURL('sort=posted%3Adesc').sort.key).toBe('posted');
    const state = { ...baseState(), sort: { key: 'posted', dir: 'asc' as const } };
    expect(parseURL(serializeURL(state)).sort).toEqual(state.sort);
  });

  it('parses score range', () => {
    const result = parseURL('score=3-5');
    expect(result.score.min).toBe(3);
    expect(result.score.max).toBe(5);
  });

  it('rejects out-of-range score', () => {
    const result = parseURL('score=-1-6');
    expect(result.score.min).toBe(DEFAULTS.score.min);
    expect(result.score.max).toBe(DEFAULTS.score.max);
  });

  it('parses valid statuses only', () => {
    const result = parseURL('status=applied%2Cbadstatus%2Cinterview');
    expect(result.status).toEqual(['applied', 'interview']);
  });

  it('parses valid seniority / work_mode values only', () => {
    expect(parseURL('seniority=Mid%2CBogus%2CStaff').seniority).toEqual(['Mid', 'Staff']);
    expect(parseURL('work_mode=Remote%2CMoon%2COn-site').work_mode).toEqual(['Remote', 'On-site']);
  });

  it('rejects unknown sort keys', () => {
    const result = parseURL('sort=badkey%3Aasc');
    expect(result.sort.key).toBe(DEFAULTS.sort.key);
  });

  it('parses date windows', () => {
    expect(parseURL('date=7d').date).toBe('7d');
    expect(parseURL('date=30d').date).toBe('30d');
    expect(parseURL('date=90d').date).toBe('90d');
  });

  it('round-trips state through serialize→parse', () => {
    const original = {
      ...baseState(),
      q: 'search term',
      sort: { key: 'date', dir: 'asc' as const },
      score: { min: 2, max: 4 },
      status: ['applied', 'interview'],
      archetype: ['IC Lead'],
      seniority: ['Mid'],
      work_mode: ['Remote', 'Hybrid'],
      date: '30d',
    };
    const parsed = parseURL(serializeURL(original));
    expect(parsed.q).toBe(original.q);
    expect(parsed.sort).toEqual(original.sort);
    expect(parsed.score).toEqual(original.score);
    expect(parsed.status).toEqual(original.status);
    expect(parsed.archetype).toEqual(original.archetype);
    expect(parsed.seniority).toEqual(original.seniority);
    expect(parsed.work_mode).toEqual(original.work_mode);
    expect(parsed.date).toBe(original.date);
  });
});

describe('getActivePills', () => {
  it('returns empty array for defaults', () => {
    expect(getActivePills(baseState())).toHaveLength(0);
  });

  it('returns score pill when non-default', () => {
    const pills = getActivePills({ ...baseState(), score: { min: 3, max: 5 } });
    expect(pills.some(p => p.key === 'score')).toBe(true);
  });

  it('returns status pill when filters active', () => {
    const pills = getActivePills({ ...baseState(), status: ['applied'] });
    expect(pills.some(p => p.key === 'status')).toBe(true);
  });

  it('returns date pill for non-all value', () => {
    const pills = getActivePills({ ...baseState(), date: '7d' });
    expect(pills.find(p => p.key === 'date')?.label).toBe('Last 7 days');
  });

  it('returns a seniority pill (single name when length 1)', () => {
    const pills = getActivePills({ ...baseState(), seniority: ['Mid'] });
    expect(pills.find(p => p.key === 'seniority')?.label).toBe('Mid');
  });

  it('returns a work_mode pill (count when multiple)', () => {
    const pills = getActivePills({ ...baseState(), work_mode: ['Remote', 'Hybrid'] });
    expect(pills.find(p => p.key === 'work_mode')?.label).toBe('Work mode: 2');
  });

  it('returns archetype pill with single name if length=1', () => {
    const pills = getActivePills({ ...baseState(), archetype: ['IC Lead'] });
    expect(pills.find(p => p.key === 'archetype')?.label).toBe('IC Lead');
  });
});

describe('comp (salary) URL + pills', () => {
  it('serializes a non-default comp range', () => {
    expect(serializeURL({ ...baseState(), comp: { min: 150, max: 500 } })).toContain(
      'comp=150-500',
    );
  });
  it('round-trips through parseURL within bounds', () => {
    expect(parseURL('comp=150-400').comp).toEqual({ min: 150, max: 400 });
  });
  it('rejects an out-of-bounds or inverted comp range (falls back to default)', () => {
    expect(parseURL('comp=100-9999').comp).toEqual(DEFAULTS.comp);
    expect(parseURL('comp=400-100').comp).toEqual(DEFAULTS.comp);
  });
  it('emits a Salary pill, with a "+" at the cap', () => {
    const pills = getActivePills({ ...baseState(), comp: { min: 150, max: 500 } });
    expect(pills.find(p => p.key === 'comp')?.label).toBe('Salary $150K–$500K+');
  });
});
