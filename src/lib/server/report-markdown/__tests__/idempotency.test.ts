// Idempotency + #19 round-trip property tests.
//
// `dirty-019.md` is a representative reproduction of report #19's defect set
// (serializer escapes, emoji + Obsidian blockquote callouts, a mid-word color
// span, em/en dashes, an empty <details>, a dangling `>`, and a `**PDF:**`
// line) — NOT a copy of live user data. The properties asserted here are the
// normalizer's core contract: `normalize(normalize(x)) === normalize(x)`, and a
// once-normalized #19 carries no error-level issues and none of the #19 defects.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkReportMarkdown, normalizeReportMarkdown } from '../index';

const dirty = readFileSync('test/fixtures/reports/dirty-019.md', 'utf8');

describe('#19 fixture idempotency + round-trip', () => {
  it('normalize is idempotent', () => {
    const once = normalizeReportMarkdown(dirty).markdown;
    expect(normalizeReportMarkdown(once).markdown).toBe(once);
  });

  it('a normalized #19 has no error-level issues', () => {
    const once = normalizeReportMarkdown(dirty).markdown;
    expect(checkReportMarkdown(once).filter(i => i.severity === 'error')).toEqual([]);
  });

  it('normalized #19 contains no \\## , no > emoji callout, no inline color span', () => {
    const once = normalizeReportMarkdown(dirty).markdown;
    expect(once).not.toMatch(/\\#/);
    expect(once).not.toMatch(/^>\s*[✅⚠️🛑💡]/m);
    expect(once).not.toMatch(/<span[^>]*color/);
    // Em/en dashes are intentionally preserved now (the rule was removed).
  });
});
