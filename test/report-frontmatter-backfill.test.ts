import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '@/lib/server/reports';

// Regression: an evaluation report whose generator omitted the required
// `status`/`state` frontmatter must still parse (it previously threw, so the
// report page showed "report not yet generated"). The loader backfills the
// missing field instead of failing.
describe('parseFrontmatter status/state backfill', () => {
  const base = [
    'num: 19',
    'company: Otter.ai',
    'role: Solutions Engineer',
    'date: "2025-12-01"',
    'score: 3.7',
  ];
  const wrap = (lines: string[]) => `---\n${lines.join('\n')}\n---\n\n## TL;DR: x\n\nbody\n`;

  it('backfills both status and state when neither is present (the #19 bug)', () => {
    const { frontmatter, body } = parseFrontmatter(wrap(base));
    expect(frontmatter.status).toBe('Evaluated');
    expect(frontmatter.state).toBe('evaluated');
    expect(body).toContain('## TL;DR: x');
  });

  it('derives state from an existing status', () => {
    const { frontmatter } = parseFrontmatter(wrap([...base, 'status: Screened']));
    expect(frontmatter.state).toBe('screened');
  });

  it('derives status from an existing state', () => {
    const { frontmatter } = parseFrontmatter(wrap([...base, 'state: screened']));
    expect(frontmatter.status).toBe('Screened');
  });

  it('leaves a well-formed report untouched', () => {
    const { frontmatter } = parseFrontmatter(
      wrap([...base, 'status: Evaluated', 'state: evaluated']),
    );
    expect(frontmatter.status).toBe('Evaluated');
    expect(frontmatter.state).toBe('evaluated');
  });
});
