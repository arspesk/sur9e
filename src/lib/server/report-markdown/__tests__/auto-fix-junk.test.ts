import { describe, expect, it } from 'vitest';
import { normalizeReportMarkdown } from '../index';

describe('junk-node auto-fixers', () => {
  it('unwraps inline color spans (mid-word corruption)', () => {
    const out = normalizeReportMarkdown(
      'mental tr<span style="color: rgb(160,117,89);">oublesho</span>oting',
    ).markdown;
    expect(out).toBe('mental troubleshooting');
  });

  it('strips empty details / empty callout / dangling blockquote', () => {
    expect(
      normalizeReportMarkdown(
        'x\n\n<details class="be-details" open=""><summary></summary><div data-type="detailsContent"><p></p></div></details>\n\ny',
      ).markdown,
    ).not.toContain('<details');
    expect(normalizeReportMarkdown('x\n\n>\n\ny').markdown).not.toMatch(/^>\s*$/m);
  });

  it('leaves non-empty details and callouts intact', () => {
    const keep = '<div data-callout data-variant="info">\n\nreal body\n\n</div>';
    expect(normalizeReportMarkdown(keep).markdown).toContain('real body');
  });

  it('does not unwrap spans inside fenced code', () => {
    const code = '```\n<span style="color: red;">x</span>\n```\n';
    expect(normalizeReportMarkdown(code).markdown).toBe(code);
  });
});
