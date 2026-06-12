import { describe, expect, it } from 'vitest';
import { normalizeReportMarkdown } from '../index';

describe('callout auto-fixers', () => {
  it('converts emoji blockquote callouts to data-callout (variant from emoji)', () => {
    const out = normalizeReportMarkdown('> ✅ Strongest match: maps direct.').markdown;
    expect(out).toContain('<div data-callout data-variant="success" data-emoji="✅">');
    expect(out).toContain('Strongest match: maps direct.');
    expect(out).not.toMatch(/^>/m);
  });

  it('maps ⚠️ -> warn, 🛑 -> error', () => {
    expect(normalizeReportMarkdown('> ⚠️ Watch-out').markdown).toContain('data-variant="warn"');
    expect(normalizeReportMarkdown('> 🛑 Do not apply').markdown).toContain('data-variant="error"');
  });

  it('converts Obsidian [!callout] to data-callout, even when bracket-escaped', () => {
    const out = normalizeReportMarkdown('> \\[!callout\\] Candidate angle x').markdown;
    expect(out).toContain('<div data-callout data-variant="info"');
    expect(out).toContain('Candidate angle x');
  });

  it('leaves plain blockquotes untouched', () => {
    const q = '> A bare section takeaway.';
    expect(normalizeReportMarkdown(q).markdown).toBe(q);
  });

  it('does not convert blockquotes inside fenced code', () => {
    const code = '```\n> ✅ not a callout\n```\n';
    expect(normalizeReportMarkdown(code).markdown).toBe(code);
  });
});
