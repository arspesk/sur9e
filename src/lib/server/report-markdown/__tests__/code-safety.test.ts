// Code-block / inline-code safety: the normalizer must never mutate or
// false-flag markup shown INSIDE a fenced code block or an inline `code` span.
// These guard the spec's core "never touch code-block interiors" promise.

import { describe, expect, it } from 'vitest';
import { checkReportMarkdown, normalizeReportMarkdown } from '../index';

const fence = (inner: string) => '```\n' + inner + '\n```\n';

describe('auto-fix code-block safety', () => {
  it('empty-node does NOT strip an empty <details> shown inside a fenced block', () => {
    const md = `before\n\n${fence('<details><summary></summary></details>')}\nafter`;
    expect(normalizeReportMarkdown(md).markdown).toContain(
      '<details><summary></summary></details>',
    );
  });

  it('empty-node does NOT strip an empty <div data-callout> inside a fence', () => {
    const md = fence('<div data-callout data-variant="info"></div>');
    expect(normalizeReportMarkdown(md).markdown).toContain(
      '<div data-callout data-variant="info"></div>',
    );
  });

  it('inline-color-span leaves a span inside inline code untouched', () => {
    const md = 'Use `<span style="color:red">x</span>` literally.';
    expect(normalizeReportMarkdown(md).markdown).toBe(
      'Use `<span style="color:red">x</span>` literally.',
    );
  });
});

describe('validator code-block safety', () => {
  const tldr = '## TL;DR\n\nverdict\n';
  const ns =
    '<div data-callout data-variant="error" data-emoji="🛑">\n\n**Next Steps** Do not apply.\n\n</div>';

  it('unbalanced-html does not count <div> shown inside a fenced block', () => {
    const md = `${ns}\n\n${tldr}\n${fence('<div data-callout data-variant="info">\n\nexample\n\n</div>')}`;
    const ids = checkReportMarkdown(md).map(i => i.rule);
    expect(ids).not.toContain('unbalanced-html');
  });

  it('callout-variant does not flag a callout shown inside a fenced block', () => {
    const md = `${ns}\n\n${tldr}\n${fence('<div data-callout>\n\nno variant here, but it is an example\n\n</div>')}`;
    const ids = checkReportMarkdown(md).map(i => i.rule);
    expect(ids).not.toContain('callout-variant');
  });

  it('next-steps-single counts only the real callout, not one inside a fence', () => {
    const md = `${ns}\n\n${tldr}\n${fence(ns)}`;
    const ids = checkReportMarkdown(md).map(i => i.rule);
    expect(ids).not.toContain('next-steps-single');
    expect(ids).not.toContain('next-steps-first');
  });
});
