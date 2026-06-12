// test/posted-date.test.mjs
//
// Unit tests for batch/lib/posted-date.mjs — the single normalization funnel
// every posting-date source (ATS JSON, JobSpy CSV, Workday relative text,
// evaluate-mode frontmatter) passes through. Contract: absent/invalid input
// yields `undefined` (the field is omitted downstream), never an empty
// string, never a fabricated date.

import { describe, expect, it } from 'vitest';
import { isValidIsoDate, parseWorkdayPostedOn, toIsoDate } from '../batch/lib/posted-date.mjs';

describe('isValidIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(isValidIsoDate('2026-06-10')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true); // leap day
  });

  it('rejects rolled-over and malformed dates', () => {
    expect(isValidIsoDate('2026-02-31')).toBe(false); // JS would roll to March
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-6-1')).toBe(false); // not zero-padded
    expect(isValidIsoDate('06/10/2026')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
  });

  it('rejects dates outside the sanity window', () => {
    expect(isValidIsoDate('1970-01-01')).toBe(false); // epoch-zero artifact
    expect(isValidIsoDate('2150-01-01')).toBe(false);
  });
});

describe('toIsoDate', () => {
  it('passes through plain YYYY-MM-DD strings verbatim', () => {
    expect(toIsoDate('2026-06-08')).toBe('2026-06-08');
  });

  it('takes the calendar-date prefix of ISO datetimes without timezone shifting', () => {
    // -04:00 offset: converting to UTC would land on 2026-06-10 — the
    // calendar day the source stated must win.
    expect(toIsoDate('2026-06-09T23:00:30-04:00')).toBe('2026-06-09');
    expect(toIsoDate('2026-05-30T08:12:00.000Z')).toBe('2026-05-30');
    expect(toIsoDate('2026-05-30 08:12:00')).toBe('2026-05-30');
  });

  it('converts epoch milliseconds (Lever createdAt) to the UTC calendar date', () => {
    expect(toIsoDate(Date.UTC(2026, 4, 15, 12, 0, 0))).toBe('2026-05-15');
  });

  it('converts Date instances (js-yaml unquoted date parse)', () => {
    expect(toIsoDate(new Date(Date.UTC(2026, 5, 1)))).toBe('2026-06-01');
    expect(toIsoDate(new Date('nonsense'))).toBeUndefined();
  });

  it('returns undefined for absent/invalid input — never an empty string', () => {
    expect(toIsoDate(undefined)).toBeUndefined();
    expect(toIsoDate(null)).toBeUndefined();
    expect(toIsoDate('')).toBeUndefined();
    expect(toIsoDate('Posted 3 Days Ago')).toBeUndefined();
    expect(toIsoDate('2026-02-31')).toBeUndefined(); // invalid calendar day
    expect(toIsoDate(Number.NaN)).toBeUndefined();
    expect(toIsoDate(0)).toBeUndefined(); // epoch zero = garbage, not a posting date
    expect(toIsoDate({})).toBeUndefined();
  });
});

describe('parseWorkdayPostedOn', () => {
  const SCAN = '2026-06-10';

  it('resolves Today / Yesterday against the scan date', () => {
    expect(parseWorkdayPostedOn('Posted Today', SCAN)).toBe('2026-06-10');
    expect(parseWorkdayPostedOn('Posted Yesterday', SCAN)).toBe('2026-06-09');
  });

  it('resolves "N Days Ago" forms, including the 30+ lower bound', () => {
    expect(parseWorkdayPostedOn('Posted 3 Days Ago', SCAN)).toBe('2026-06-07');
    expect(parseWorkdayPostedOn('Posted 1 Day Ago', SCAN)).toBe('2026-06-09');
    // "30+" is a lower bound — the resolved date is the NEWEST it could be.
    expect(parseWorkdayPostedOn('Posted 30+ Days Ago', SCAN)).toBe('2026-05-11');
  });

  it('crosses month boundaries correctly', () => {
    expect(parseWorkdayPostedOn('Posted 12 Days Ago', SCAN)).toBe('2026-05-29');
  });

  it('returns undefined for unparseable text or an invalid scan date', () => {
    expect(parseWorkdayPostedOn('Posted Recently', SCAN)).toBeUndefined();
    expect(parseWorkdayPostedOn('', SCAN)).toBeUndefined();
    expect(parseWorkdayPostedOn(undefined, SCAN)).toBeUndefined();
    expect(parseWorkdayPostedOn('Posted 3 Days Ago', 'not-a-date')).toBeUndefined();
    expect(parseWorkdayPostedOn('Posted 3 Days Ago', undefined)).toBeUndefined();
  });
});
