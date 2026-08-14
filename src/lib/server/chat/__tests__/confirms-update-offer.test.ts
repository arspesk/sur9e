// src/lib/server/chat/__tests__/confirms-update-offer.test.ts
//
// The 'update-offer' confirm kind, exercised against the REAL turn-runner and
// store modules (no vi.mock) — a lighter-weight, complementary check to
// test/unit/chat/confirms.test.ts's heavily-mocked 'update-offer confirms'
// suite. Approval re-validates against fresh reads and applies the change-set
// (fields and/or sequential body edits) through applyOfferUpdate; a vanished
// old_text becomes a { ok:false } result (never a silent clobber); cancel
// writes nothing. describeUpdateOffer's card-copy formatting (summary
// override, ≤40-char preview clipping, whitespace collapsing, body-edit-count
// segment) is unit-tested directly against a hand-built OfferUpdateChangeSet.
//
// Ported from confirms-edit-report.test.ts (issue #74's edit-report → update-
// offer swap): unlike the old EditReportPayload, update-offer's
// validateOfferUpdate re-derives the report path from the tracker (no
// caller-supplied filePath), so the fixture needs a real data/applications.md
// row alongside the report file under artifacts/reports/.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReportFrontmatter } from '../../../schemas/reports';
import type { OfferUpdateChangeSet } from '../../offer-update';
import { createConfirm, describeUpdateOffer, resolveConfirm } from '../confirms';

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | Posted |
|---|------|---------|------|-------|--------|-----|--------|-------|--------|
| 7 | 2026-07-01 | Acme | Staff Engineer | 4.1/5 | Evaluated | ❌ | [7](artifacts/reports/007-acme-2026-07-01.md) | - |  |
`;

const REPORT = `---
num: 7
company: Acme
role: Staff Engineer
date: '2026-07-01'
status: Evaluated
state: evaluated
score: 4.1
---

# Evaluation

The comp band looks below market.
`;

let dir: string;
let reportPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sur9e-confirm-update-offer-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'artifacts/reports'), { recursive: true });
  writeFileSync(join(dir, 'data/applications.md'), TRACKER, 'utf8');
  reportPath = join(dir, 'artifacts/reports/007-acme-2026-07-01.md');
  writeFileSync(reportPath, REPORT, 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function parkBodyEdit(oldText: string, newText: string) {
  return createConfirm(dir, {
    turnId: 'turn-under-test',
    kind: 'update-offer',
    payload: { num: 7, bodyEdits: [{ oldText, newText }] },
    summary: 'Update offer #7',
    meta: 'no AI spend',
  });
}

describe("resolveConfirm 'update-offer'", () => {
  it('approve applies a body edit to the file and returns { ok, offerUpdate }', async () => {
    const { token } = parkBodyEdit(
      'The comp band looks below market.',
      'The comp band is competitive.',
    );
    const res = await resolveConfirm(dir, token, true);

    expect(res.outcome).toBe('approved');
    expect(res.result).toMatchObject({
      ok: true,
      offerUpdate: { num: 7, changed: [], bodyEditCount: 1 },
    });

    const after = readFileSync(reportPath, 'utf8');
    expect(after).toContain('The comp band is competitive.');
    expect(after).not.toContain('below market');
    // Frontmatter untouched.
    expect(after).toContain('company: Acme');
  });

  it('approve with a vanished old_text yields { ok:false, error } and leaves the file alone', async () => {
    const { token } = parkBodyEdit('The comp band looks below market.', 'edited.');
    // Race: the source text is gone by the time the user approves.
    const mutated = readFileSync(reportPath, 'utf8').replace(
      'The comp band looks below market.',
      'Rewritten out of band.',
    );
    writeFileSync(reportPath, mutated, 'utf8');

    const res = await resolveConfirm(dir, token, true);
    expect(res.outcome).toBe('approved');
    expect(res.result?.ok).toBe(false);
    if (res.result?.ok === false) {
      expect(res.result.error).toBe('text to replace not found in report #7');
    }
    // The out-of-band content survived — no clobber.
    expect(readFileSync(reportPath, 'utf8')).toContain('Rewritten out of band.');
  });

  it('cancel writes nothing', async () => {
    const { token } = parkBodyEdit('The comp band looks below market.', 'should not be written');
    const res = await resolveConfirm(dir, token, false);
    expect(res.outcome).toBe('cancelled');
    expect(res.result).toBeUndefined();
    expect(readFileSync(reportPath, 'utf8')).toBe(REPORT);
  });
});

describe('describeUpdateOffer', () => {
  // fieldChanges/bodyEditCount are all describeUpdateOffer reads; the rest of
  // the change-set only needs to be type-valid, never inspected by it.
  const baseFrontmatter = ReportFrontmatter.parse({
    num: 7,
    company: 'Acme',
    role: 'Staff Engineer',
    date: '2026-07-01',
    status: 'Evaluated',
    state: 'evaluated',
    score: 4.1,
  });

  function changeSet(overrides: Partial<OfferUpdateChangeSet> = {}): OfferUpdateChangeSet {
    return {
      num: 7,
      filePath: reportPath,
      company: 'Acme',
      fieldChanges: [],
      bodyEditCount: 0,
      nextFrontmatter: baseFrontmatter,
      nextBody: '',
      trackerCells: {},
      ...overrides,
    };
  }

  it('defaults the summary to "Update offer #<num> — <company>" and previews each field change', () => {
    const { summary, meta } = describeUpdateOffer(
      changeSet({
        fieldChanges: [
          {
            field: 'tldr',
            from: 'the long original passage here',
            to: 'shorter',
            target: 'frontmatter',
          },
        ],
      }),
    );
    expect(summary).toBe('Update offer #7 — Acme');
    expect(meta).toBe('tldr: "the long original passage here" → "shorter" · no AI spend');
  });

  it('honors a provided summary and clips long previews to 40 chars with an ellipsis', () => {
    const long = 'x'.repeat(80);
    const { summary, meta } = describeUpdateOffer(
      changeSet({ fieldChanges: [{ field: 'tldr', from: long, to: 'y', target: 'frontmatter' }] }),
      'shorten the risk section',
    );
    expect(summary).toBe('shorten the risk section');
    expect(meta).toBe(`tldr: "${'x'.repeat(40)}…" → "y" · no AI spend`);
  });

  it('collapses whitespace in the preview', () => {
    const { meta } = describeUpdateOffer(
      changeSet({
        fieldChanges: [{ field: 'tldr', from: 'a\n\n  b   c', to: 'd', target: 'frontmatter' }],
      }),
    );
    expect(meta).toBe('tldr: "a b c" → "d" · no AI spend');
  });

  it('appends a body-edit-count segment alongside field changes', () => {
    const { meta } = describeUpdateOffer(
      changeSet({
        fieldChanges: [{ field: 'url', from: '', to: 'https://acme.dev', target: 'frontmatter' }],
        bodyEditCount: 2,
      }),
    );
    expect(meta).toBe('url: "" → "https://acme.dev" · 2 body edits · no AI spend');
  });
});
