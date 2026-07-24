// src/lib/server/__tests__/reports-edit.test.ts
//
// Unit tests for applyReportBodyEdit — the pure find/replace helper behind the
// chat edit_report action. Mirrors the Edit-tool contract: exact + unique match
// on the BODY only, frontmatter never touched.

import { describe, expect, it } from 'vitest';
import { applyReportBodyEdit, parseFrontmatter } from '../reports';

const FRONTMATTER = [
  '---',
  'num: 7',
  'company: "Acme"',
  'role: "Staff Engineer"',
  'date: "2026-07-01"',
  'status: "Evaluated"',
  'state: "evaluated"',
  'score: 4.1',
  '---',
].join('\n');

function report(body: string): string {
  return `${FRONTMATTER}\n\n${body}`;
}

describe('applyReportBodyEdit', () => {
  it('replaces a unique match and preserves frontmatter + unrelated body', () => {
    const md = report(
      '# Evaluation\n\nThe risk section is long and rambling.\n\n## Next steps\n\n- ping the recruiter\n',
    );
    const result = applyReportBodyEdit(
      md,
      'The risk section is long and rambling.',
      'Risk: tight.',
    );
    expect('markdown' in result).toBe(true);
    if (!('markdown' in result)) return;

    const { frontmatter, body } = parseFrontmatter(result.markdown);
    // Frontmatter is byte-for-byte the same object after a round-trip.
    expect(frontmatter).toEqual(parseFrontmatter(md).frontmatter);
    // New text in, old text gone, unrelated body kept.
    expect(body).toContain('Risk: tight.');
    expect(body).not.toContain('long and rambling');
    expect(body).toContain('# Evaluation');
    expect(body).toContain('- ping the recruiter');
  });

  it('returns an error for 0 matches (no card should be shown)', () => {
    const md = report('# Evaluation\n\nbody\n');
    const result = applyReportBodyEdit(md, 'text that is absent', 'x');
    expect(result).toEqual({ error: 'text to replace not found' });
  });

  it('returns a count-bearing error for >1 matches', () => {
    const md = report('# Evaluation\n\nrepeat me\nrepeat me\nrepeat me\n');
    const result = applyReportBodyEdit(md, 'repeat me', 'x');
    expect(result).toEqual({
      error: 'old_text matches 3 places — add surrounding context to make it unique',
    });
  });

  it('never mutates the frontmatter even when body text overlaps a frontmatter value', () => {
    // "Acme" appears in the frontmatter AND once in the body — the edit must
    // only touch the body occurrence.
    const md = report('# Evaluation\n\nAcme is a strong match.\n');
    const result = applyReportBodyEdit(md, 'Acme is a strong match.', 'Acme is a weak match.');
    expect('markdown' in result).toBe(true);
    if (!('markdown' in result)) return;
    const { frontmatter, body } = parseFrontmatter(result.markdown);
    expect(frontmatter.company).toBe('Acme');
    expect(body).toContain('weak match');
  });

  it('rejects a non-frontmatter document', () => {
    const result = applyReportBodyEdit('# plain markdown, no frontmatter\n', 'plain', 'x');
    expect(result).toEqual({ error: 'report is not in frontmatter format' });
  });

  it('rejects an empty old_text', () => {
    const md = report('# Evaluation\n\nbody\n');
    const result = applyReportBodyEdit(md, '', 'x');
    expect(result).toEqual({ error: 'text to replace not found' });
  });

  it('splices new_text literally — $-patterns are not interpreted', () => {
    const md = report('# Evaluation\n\nreplace HERE now.\n');
    const result = applyReportBodyEdit(md, 'HERE', '$& $1 $`');
    expect('markdown' in result).toBe(true);
    if (!('markdown' in result)) return;
    const { body } = parseFrontmatter(result.markdown);
    expect(body).toContain('replace $& $1 $` now.');
  });
});
