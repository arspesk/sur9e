// src/lib/server/chat/__tests__/confirms-edit-report.test.ts
//
// The 'edit-report' confirm kind: approval re-reads the file and applies the
// surgical body edit through saveReport; a vanished old_text becomes a
// { ok:false } result (never a silent clobber); cancel writes nothing.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConfirm, describeEditReport, resolveConfirm } from '../confirms';

const REPORT = [
  '---',
  'num: 7',
  'company: "Acme"',
  'role: "Staff Engineer"',
  'date: "2026-07-01"',
  'status: "Evaluated"',
  'state: "evaluated"',
  'score: 4.1',
  '---',
  '',
  '# Evaluation',
  '',
  'The comp band looks below market.',
  '',
].join('\n');

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sur9e-confirm-edit-'));
  filePath = join(dir, '007-acme-2026-07-01.md');
  writeFileSync(filePath, REPORT, 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function parkEdit(oldText: string, newText: string) {
  return createConfirm(dir, {
    turnId: 'turn-under-test',
    kind: 'edit-report',
    payload: { num: 7, filePath, oldText, newText },
    summary: 'Edit report #7',
    meta: 'report write · no AI spend',
  });
}

describe("resolveConfirm 'edit-report'", () => {
  it('approve applies the edit to the file and returns { ok, report }', async () => {
    const { token } = parkEdit(
      'The comp band looks below market.',
      'The comp band is competitive.',
    );
    const res = await resolveConfirm(dir, token, true);

    expect(res.outcome).toBe('approved');
    expect(res.result).toEqual({ ok: true, report: { num: 7 } });

    const after = readFileSync(filePath, 'utf8');
    expect(after).toContain('The comp band is competitive.');
    expect(after).not.toContain('below market');
    // Frontmatter untouched.
    expect(after).toContain('company: Acme');
  });

  it('approve with a vanished old_text yields { ok:false, error } and leaves the file alone', async () => {
    const { token } = parkEdit('The comp band looks below market.', 'edited.');
    // Race: the source text is gone by the time the user approves.
    const mutated = REPORT.replace('The comp band looks below market.', 'Rewritten out of band.');
    writeFileSync(filePath, mutated, 'utf8');

    const res = await resolveConfirm(dir, token, true);
    expect(res.outcome).toBe('approved');
    expect(res.result?.ok).toBe(false);
    if (res.result?.ok === false) {
      expect(res.result.error).toBe('text to replace not found');
    }
    // The out-of-band content survived — no clobber.
    expect(readFileSync(filePath, 'utf8')).toContain('Rewritten out of band.');
  });

  it('cancel writes nothing', async () => {
    const { token } = parkEdit('The comp band looks below market.', 'should not be written');
    const res = await resolveConfirm(dir, token, false);
    expect(res.outcome).toBe('cancelled');
    expect(res.result).toBeUndefined();
    expect(readFileSync(filePath, 'utf8')).toBe(REPORT);
  });
});

describe('describeEditReport', () => {
  it('defaults the summary to "Edit report #<num>" and previews the change', () => {
    const { summary, meta } = describeEditReport(7, 'the long original passage here', 'shorter');
    expect(summary).toBe('Edit report #7');
    expect(meta).toBe('report write · "the long original passage here" → "shorter" · no AI spend');
  });

  it('honors a provided summary and clips long previews to 40 chars with an ellipsis', () => {
    const long = 'x'.repeat(80);
    const { summary, meta } = describeEditReport(7, long, 'y', 'shorten the risk section');
    expect(summary).toBe('shorten the risk section');
    expect(meta).toBe(`report write · "${'x'.repeat(40)}…" → "y" · no AI spend`);
  });

  it('collapses whitespace in the preview', () => {
    const { meta } = describeEditReport(7, 'a\n\n  b   c', 'd');
    expect(meta).toBe('report write · "a b c" → "d" · no AI spend');
  });
});
