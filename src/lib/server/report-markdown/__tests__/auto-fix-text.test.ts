import { describe, expect, it } from 'vitest';
import { normalizeReportMarkdown } from '../index';

describe('text auto-fixers', () => {
  it('unescapes serializer backslash escapes outside code', () => {
    expect(normalizeReportMarkdown('\\## TL;DR').markdown).toBe('## TL;DR');
    expect(normalizeReportMarkdown('touchpoints \\~60% strong').markdown).toContain('~60%');
    expect(normalizeReportMarkdown('see \\[bracket\\] here').markdown).toContain('[bracket]');
  });

  it('does NOT unescape inside fenced code', () => {
    const code = '```\n\\## not a heading\n```\n';
    expect(normalizeReportMarkdown(code).markdown).toBe(code);
  });

  it('drops the **PDF:** body line', () => {
    expect(normalizeReportMarkdown('a\n\n**PDF:** [x](/y)\n\nb').markdown).not.toContain(
      '**PDF:**',
    );
  });

  it('collapses 3+ blank lines to one', () => {
    expect(normalizeReportMarkdown('a\n\n\n\nb').markdown).toBe('a\n\nb');
  });
});
