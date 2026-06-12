import { describe, expect, it } from 'vitest';
import {
  displayDate,
  fmtDate,
  mapEntryToR,
  markedInline,
  numFromFilename,
  STALE_POSTED_DAYS,
  sevWeight,
} from '@/features/report/report-types';

describe('fmtDate', () => {
  it('returns empty string for falsy input', () => {
    expect(fmtDate(undefined)).toBe('');
    expect(fmtDate('')).toBe('');
  });
  it('returns the original string when Date constructor fails silently', () => {
    // Intl will silently render Invalid Date — we just check it doesn't throw
    // and returns a string.
    expect(typeof fmtDate('2026-05-13')).toBe('string');
  });
  it('renders the stored day regardless of the viewer timezone (no UTC off-by-one)', () => {
    // YYYY-MM-DD parses as UTC midnight; formatting must pin to UTC so a
    // viewer behind UTC doesn't see the previous day. Day + year are
    // locale-stable; assert them rather than the month token.
    expect(fmtDate('2026-06-09')).toContain('9');
    expect(fmtDate('2026-06-09')).toContain('2026');
    expect(fmtDate('2026-01-01')).toContain('1');
    expect(fmtDate('2026-01-01')).toContain('2026');
  });
});

describe('markedInline', () => {
  it('converts **bold** to <strong>', () => {
    expect(markedInline('hello **world**')).toBe('hello <strong>world</strong>');
  });
  it('converts *italic* to <em>', () => {
    expect(markedInline('*foo*')).toBe('<em>foo</em>');
  });
  it('escapes html before applying markdown', () => {
    expect(markedInline('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('sevWeight', () => {
  it('weights severities high-to-low', () => {
    expect(sevWeight('hard_blocker')).toBe(4);
    expect(sevWeight('high')).toBe(3);
    expect(sevWeight('medium')).toBe(2);
    expect(sevWeight('low')).toBe(1);
    expect(sevWeight('unknown')).toBe(0);
  });
});

describe('numFromFilename', () => {
  it('extracts leading integer', () => {
    expect(numFromFilename('005-wisq-2026-05-13.md')).toBe(5);
    expect(numFromFilename('123-acme-2026-01-01.md')).toBe(123);
  });
  it('returns null for non-conforming names', () => {
    expect(numFromFilename('xyz-2026-05-13.md')).toBeNull();
    expect(numFromFilename('')).toBeNull();
  });
});

describe('displayDate', () => {
  const now = new Date('2026-06-10T12:00:00Z');

  it('shows the posted date when the source reported one', () => {
    const dd = displayDate({ posted: '2026-06-01', date: '2026-06-08' }, now);
    expect(dd).toEqual({ kind: 'posted', value: '2026-06-01', stale: false });
  });

  it('falls back to the added/scan date when posted is absent', () => {
    const dd = displayDate({ date: '2026-06-08' }, now);
    expect(dd).toEqual({ kind: 'added', value: '2026-06-08', stale: false });
  });

  it('returns an empty added value when both dates are absent', () => {
    expect(displayDate({}, now)).toEqual({ kind: 'added', value: '', stale: false });
  });

  it(`flags posted dates older than ${STALE_POSTED_DAYS} days as stale`, () => {
    // 2026-05-11 is exactly 30 days before now's date — NOT stale (> not >=).
    expect(displayDate({ posted: '2026-05-11' }, now).stale).toBe(false);
    // 2026-05-10 is 31 days back — stale.
    expect(displayDate({ posted: '2026-05-10' }, now).stale).toBe(true);
  });

  it('never marks the added-date fallback stale', () => {
    expect(displayDate({ date: '2020-01-01' }, now).stale).toBe(false);
  });

  it('treats an unparseable posted date as non-stale but still posted', () => {
    const dd = displayDate({ posted: 'not-a-date', date: '2026-06-08' }, now);
    expect(dd.kind).toBe('posted');
    expect(dd.stale).toBe(false);
  });
});

describe('mapEntryToR', () => {
  it('returns null when entry has no parsed report', () => {
    expect(mapEntryToR({ num: 1, company: 'Acme', role: 'Eng' })).toBeNull();
  });
  it('maps an evaluated entry to a renderer-shaped r', () => {
    const entry = {
      num: 5,
      company: 'WisQ',
      role: 'Sr. Designer',
      date: '2026-05-13',
      status: 'Evaluated',
      score: 4.2,
      report: {
        parsed: {
          state: 'evaluated' as const,
          score: 4.2,
          archetype: 'Design ops',
          seniority: 'Senior',
          locations: 'Remote',
          cv_match: [{ jd: 'X', cv: 'Y', strength: 'direct' }],
          gaps: [],
          score_breakdown: {
            cv_match: 4.5,
            seniority: 4.2,
            compensation: 4.6,
            domain: 4.4,
            geo: 5.0,
            legitimacy: 5.0,
          },
        },
      },
    };
    const r = mapEntryToR(entry);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.id).toBe('O005');
    expect(r.num).toBe(5);
    expect(r.state).toBe('evaluated');
    expect(r.status).toBe('evaluated');
    expect(r.score).toBeCloseTo(4.2);
    expect(r.archetype).toBe('Design ops');
    expect(r.cv_match).toHaveLength(1);
    expect(r.score_breakdown?.cv_match).toBe(4.5);
  });
  it('carries posted through — tracker row first, frontmatter fallback, else undefined', () => {
    const base = { num: 9, company: 'X', role: 'Y', report: { parsed: {} } };
    expect(mapEntryToR({ ...base, posted: '2026-06-01' })?.posted).toBe('2026-06-01');
    expect(mapEntryToR({ ...base, report: { parsed: { posted: '2026-06-02' } } })?.posted).toBe(
      '2026-06-02',
    );
    expect(mapEntryToR(base)?.posted).toBeUndefined();
  });

  it('lowercases status; falls back to parsed state when status is missing', () => {
    const r = mapEntryToR({
      num: 7,
      company: 'X',
      role: 'Y',
      report: { parsed: { state: 'screened' as const } },
    });
    expect(r?.status).toBe('screened');
  });
});
