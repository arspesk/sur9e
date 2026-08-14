import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as atomicWriteModule from '../atomic-write';
import { applyOfferUpdate, validateOfferUpdate } from '../offer-update';

let root: string;

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | Posted |
|---|------|---------|------|-------|--------|-----|--------|-------|--------|
| 42 | 2026-08-01 | Acme | Platform Engineer | 3.8/5 | Evaluated | ❌ | [42](artifacts/reports/042-acme-2026-08-01.md) | - |  |
| 43 | 2026-08-02 | NoReport Inc | SRE | N/A | Screened | ❌ | - | - |  |
`;

const REPORT = `---
num: 42
company: Acme
role: Platform Engineer
date: '2026-08-01'
status: Evaluated
state: evaluated
score: 3.8
archetype: Platform
tldr: Solid platform role.
---

## Summary

Acme builds infrastructure. The role is hands-on. Based on the comp and the growth trajectory, this is attractive.

## Verdict

Worth applying.
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'offer-update-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), TRACKER);
  writeFileSync(join(root, 'artifacts/reports/042-acme-2026-08-01.md'), REPORT);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('validateOfferUpdate', () => {
  it('accepts a url edit and targets frontmatter only', () => {
    const r = validateOfferUpdate(root, 42, { url: 'https://acme.dev/jobs/1' }, undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changeSet.fieldChanges).toEqual([
      { field: 'url', from: '', to: 'https://acme.dev/jobs/1', target: 'frontmatter' },
    ]);
    expect(r.changeSet.trackerCells).toEqual({});
    expect(r.changeSet.nextFrontmatter.url).toBe('https://acme.dev/jobs/1');
  });

  it('rejects a non-http(s) url', () => {
    const r = validateOfferUpdate(root, 42, { url: 'ftp://acme.dev' }, undefined);
    expect(r).toEqual({ ok: false, error: expect.stringContaining('url') });
  });

  it('targets both files for company/role and carries tracker cells', () => {
    const r = validateOfferUpdate(
      root,
      42,
      { company: 'Acme Corp', role: 'Staff Engineer' },
      undefined,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changeSet.trackerCells).toEqual({ company: 'Acme Corp', role: 'Staff Engineer' });
    expect(r.changeSet.fieldChanges.map(c => c.target)).toEqual(['both', 'both']);
    expect(r.changeSet.nextFrontmatter.company).toBe('Acme Corp');
  });

  it('rejects protected fields, pointing status at set_status', () => {
    const status = validateOfferUpdate(root, 42, { status: 'applied' }, undefined);
    expect(status).toEqual({ ok: false, error: expect.stringContaining('set_status') });
    const score = validateOfferUpdate(root, 42, { score: 5 }, undefined);
    expect(score).toEqual({ ok: false, error: expect.stringContaining('score') });
  });

  it('rejects unknown fields by name', () => {
    const r = validateOfferUpdate(root, 42, { vibe: 'good' }, undefined);
    expect(r).toEqual({ ok: false, error: expect.stringContaining('vibe') });
  });

  it('rejects a pipe in company (tracker table safety)', () => {
    const r = validateOfferUpdate(root, 42, { company: 'Acme | Evil' }, undefined);
    expect(r.ok).toBe(false);
  });

  it('rejects a bad posted date and accepts a good one (target both)', () => {
    expect(validateOfferUpdate(root, 42, { posted: 'yesterday' }, undefined).ok).toBe(false);
    const r = validateOfferUpdate(root, 42, { posted: '2026-07-15' }, undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changeSet.trackerCells.posted).toBe('2026-07-15');
  });

  it('validates seniority/work_mode against the canonical sets', () => {
    expect(validateOfferUpdate(root, 42, { seniority: 'Ninja' }, undefined).ok).toBe(false);
    expect(validateOfferUpdate(root, 42, { work_mode: 'Remote' }, undefined).ok).toBe(true);
  });

  it('drops no-op changes and errors when nothing is left', () => {
    const r = validateOfferUpdate(root, 42, { company: 'Acme' }, undefined);
    expect(r).toEqual({ ok: false, error: 'nothing to change' });
  });

  it('applies body edits sequentially — a later edit may match text a prior edit created', () => {
    const r = validateOfferUpdate(root, 42, undefined, [
      { oldText: 'Worth applying.', newText: 'Strongly worth applying.' },
      { oldText: 'Strongly worth', newText: 'Definitely worth' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changeSet.nextBody).toContain('Definitely worth applying.');
    expect(r.changeSet.bodyEditCount).toBe(2);
  });

  it('rejects a missing and an ambiguous body match with the edit_report wording', () => {
    const missing = validateOfferUpdate(root, 42, undefined, [
      { oldText: 'no such text', newText: 'x' },
    ]);
    expect(missing).toEqual({ ok: false, error: expect.stringContaining('not found') });
    const ambiguous = validateOfferUpdate(root, 42, undefined, [
      { oldText: 'the', newText: 'x' }, // appears in both sections
    ]);
    expect(ambiguous).toEqual({
      ok: false,
      error: expect.stringContaining('add surrounding context'),
    });
  });

  it('rejects an offer without a report on disk and an untracked num', () => {
    expect(validateOfferUpdate(root, 43, { url: 'https://x.dev' }, undefined)).toEqual({
      ok: false,
      error: expect.stringContaining('no report'),
    });
    expect(validateOfferUpdate(root, 999, { url: 'https://x.dev' }, undefined)).toEqual({
      ok: false,
      error: expect.stringContaining('999'),
    });
  });
});

describe('applyOfferUpdate', () => {
  it('url-only edit rewrites the report frontmatter and leaves the tracker byte-identical', () => {
    const trackerBefore = readFileSync(join(root, 'data/applications.md'), 'utf-8');
    const result = applyOfferUpdate(root, 42, { url: 'https://acme.dev/jobs/1' }, undefined);
    expect(result).toEqual({ num: 42, changed: ['url'], bodyEditCount: 0 });
    const report = readFileSync(join(root, 'artifacts/reports/042-acme-2026-08-01.md'), 'utf-8');
    expect(report).toContain('url: https://acme.dev/jobs/1');
    expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toBe(trackerBefore);
  });

  it('company+role edit updates BOTH files in sync; report filename unchanged', () => {
    applyOfferUpdate(root, 42, { company: 'Acme Corp', role: 'Staff Engineer' }, undefined);
    const tracker = readFileSync(join(root, 'data/applications.md'), 'utf-8');
    const row = tracker.split('\n').find(l => l.trim().startsWith('| 42 |'));
    expect(row).toContain('| Acme Corp |');
    expect(row).toContain('| Staff Engineer |');
    // other cells untouched
    expect(row).toContain('| 3.8/5 |');
    expect(row).toContain('| Evaluated |');
    const report = readFileSync(join(root, 'artifacts/reports/042-acme-2026-08-01.md'), 'utf-8');
    expect(report).toContain('company: Acme Corp');
    expect(report).toContain('role: Staff Engineer');
  });

  it('combined fields + body edits land together', () => {
    const result = applyOfferUpdate(root, 42, { url: 'https://acme.dev/j/1' }, [
      { oldText: 'Worth applying.', newText: 'Apply this week.' },
    ]);
    expect(result.changed).toEqual(['url']);
    expect(result.bodyEditCount).toBe(1);
    const report = readFileSync(join(root, 'artifacts/reports/042-acme-2026-08-01.md'), 'utf-8');
    expect(report).toContain('Apply this week.');
    expect(report).toContain('url: https://acme.dev/j/1');
  });

  it('restores the report when the tracker write fails (all-or-nothing)', () => {
    const reportPath = join(root, 'artifacts/reports/042-acme-2026-08-01.md');
    const reportBefore = readFileSync(reportPath, 'utf-8');
    const real = atomicWriteModule.atomicWrite;
    // First call (report) succeeds; second call (tracker) explodes.
    let calls = 0;
    const spy = vi.spyOn(atomicWriteModule, 'atomicWrite').mockImplementation((path, content) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return real(path, content);
    });
    try {
      expect(() => applyOfferUpdate(root, 42, { company: 'Acme Corp' }, undefined)).toThrow(
        'disk full',
      );
      expect(readFileSync(reportPath, 'utf-8')).toBe(reportBefore); // compensated
      const tracker = readFileSync(join(root, 'data/applications.md'), 'utf-8');
      expect(tracker).toContain('| Acme |'); // tracker unchanged
    } finally {
      spy.mockRestore();
    }
  });

  it('throws when validation fails at apply time', () => {
    expect(() => applyOfferUpdate(root, 42, { status: 'applied' }, undefined)).toThrow(
      'set_status',
    );
  });

  it('handles legacy 9-column tracker rows by inserting Posted cell (posted field)', () => {
    // Rewrite tracker with a 9-column row (no Posted column in header, 11 split parts)
    const legacyTracker = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 42 | 2026-08-01 | Acme | Platform Engineer | 3.8/5 | Evaluated | ❌ | [42](artifacts/reports/042-acme-2026-08-01.md) | - |
`;
    writeFileSync(join(root, 'data/applications.md'), legacyTracker);

    const result = applyOfferUpdate(root, 42, { posted: '2026-07-15' }, undefined);
    expect(result).toEqual({ num: 42, changed: ['posted'], bodyEditCount: 0 });

    // Verify the tracker row now has Posted at split-index 10 (12 split parts, ends with |)
    const tracker = readFileSync(join(root, 'data/applications.md'), 'utf-8');
    const row = tracker.split('\n').find(l => l.trim().startsWith('| 42 |'));
    expect(row).toBeDefined();
    const cols = row!.split('|');
    expect(cols).toHaveLength(12); // Now 12 parts (was 11)
    expect(cols[10].trim()).toBe('2026-07-15'); // Posted at index 10
    // Other cells unchanged
    expect(cols[3].trim()).toBe('Acme'); // company
    expect(cols[4].trim()).toBe('Platform Engineer'); // role
    expect(cols[5].trim()).toBe('3.8/5'); // score
    expect(cols[6].trim()).toBe('Evaluated'); // status

    // Verify report frontmatter
    const report = readFileSync(join(root, 'artifacts/reports/042-acme-2026-08-01.md'), 'utf-8');
    expect(report).toContain("posted: '2026-07-15'");
  });
});
