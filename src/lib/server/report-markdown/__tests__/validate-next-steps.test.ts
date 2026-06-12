import { describe, expect, it } from 'vitest';
import { checkReportMarkdown } from '../index';

const ids = (md: string) => checkReportMarkdown(md).map(i => i.rule);

const NS =
  '<div data-callout data-variant="error" data-emoji="🛑">\n\n**Next Steps** Do not apply.\n\n</div>';

describe('Next Steps validators', () => {
  it('flags a missing Next Steps callout', () => {
    expect(ids('## TL;DR\n\nx')).toContain('next-steps-single');
  });
  it('flags a Next Steps callout that is not the first body block', () => {
    expect(ids(`## TL;DR\n\nx\n\n${NS}`)).toContain('next-steps-first');
  });
  it('accepts exactly one Next Steps callout, first', () => {
    const ok = checkReportMarkdown(`${NS}\n\n## TL;DR\n\nx`).map(i => i.rule);
    expect(ok).not.toContain('next-steps-single');
    expect(ok).not.toContain('next-steps-first');
  });
});
