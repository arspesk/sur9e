import { describe, expect, it } from 'vitest';
import { TIER_MARK_COLOR } from '@/lib/scoring';
import { normalizeReportMarkdown } from '../index';

const ROLE_TABLE = [
  '## Role summary',
  '',
  '| Requirement | Fit | Note |',
  '| --- | --- | --- |',
  '| 5y React | direct | strong match |',
  '| GraphQL | strong | adjacent exp |',
  '| Rust | adjacent | bootcamp only |',
  '| Welsh | maybe | unknown |',
  '',
].join('\n');

describe('fit-column-color auto-fixer', () => {
  it('colors the Fit cells by JD-fit tier', () => {
    const out = normalizeReportMarkdown(ROLE_TABLE).markdown;
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.high}">direct</mark>`);
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.mid}">strong</mark>`);
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.low}">adjacent</mark>`);
  });

  it('leaves unknown Fit values plain', () => {
    const out = normalizeReportMarkdown(ROLE_TABLE).markdown;
    expect(out).toContain('| maybe |');
    expect(out).not.toContain('<mark data-color="rgba(68,131,97,0.32)">maybe</mark>');
  });

  it('is idempotent — re-coloring an already-colored table is a no-op', () => {
    const once = normalizeReportMarkdown(ROLE_TABLE).markdown;
    expect(normalizeReportMarkdown(once).markdown).toBe(once);
  });

  it('does not affect the TL;DR Axis|Score|Read table', () => {
    const tldr = [
      '| Axis | Score | Read |',
      '| --- | --- | --- |',
      '| CV match | 3.8 | strong |',
      '',
    ].join('\n');
    const out = normalizeReportMarkdown(tldr).markdown;
    // `strong` here is a Read cell, colored by score-tier-color (mid=3.8), not
    // by fit-column-color — and there is no Fit/Requirement header so the rule
    // never engages.
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.mid}">strong</mark>`);
    expect(out).not.toContain(`<mark data-color="${TIER_MARK_COLOR.high}">strong</mark>`);
  });

  it('leaves a table without a Fit column untouched', () => {
    const t = '| Topic | Detail |\n| --- | --- |\n| direct | adjacent |\n';
    expect(normalizeReportMarkdown(t).markdown).toBe(t);
  });

  it('does not touch fenced code', () => {
    const fenced = [
      '```',
      '| Requirement | Fit |',
      '| --- | --- |',
      '| 5y React | direct |',
      '```',
      '',
    ].join('\n');
    expect(normalizeReportMarkdown(fenced).markdown).toBe(fenced);
  });
});
