import { describe, expect, it } from 'vitest';
import { checkReportMarkdown } from '../index';

const ids = (md: string) => checkReportMarkdown(md).map(i => i.rule);

describe('structural + style validators', () => {
  it('flags orphaned H4 under H2 (no H3)', () => {
    expect(ids('## A\n\n#### deep\n')).toContain('heading-hierarchy');
  });
  it('flags missing TL;DR', () => {
    expect(ids('## Role summary\n')).toContain('tldr-present');
  });
  it('flags callout without a valid variant', () => {
    expect(ids('<div data-callout>\n\nx\n\n</div>')).toContain('callout-variant');
    expect(ids('<div data-callout data-variant="bogus">\n\nx\n\n</div>')).toContain(
      'callout-variant',
    );
  });
  it('flags unbalanced callout/details', () => {
    expect(ids('<div data-callout data-variant="info">\n\nx')).toContain('unbalanced-html');
  });
  it('warns on heading takeaway clause', () => {
    expect(ids('## TL;DR: strong fit; base above-band')).toContain('heading-concise');
  });
  it('warns on a fully-bold paragraph', () => {
    expect(ids('**This entire verdict paragraph is bold and long.**')).toContain('over-bold');
  });
  it('warns on off-palette generated emoji', () => {
    expect(ids('<div data-callout data-variant="info" data-emoji="🐙">\n\nx\n\n</div>')).toContain(
      'callout-emoji-palette',
    );
  });
  it('warns on table column mismatch', () => {
    expect(ids('| A | B |\n| --- | --- |\n| 1 |\n')).toContain('table-columns');
  });
});
