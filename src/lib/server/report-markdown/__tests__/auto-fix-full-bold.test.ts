import { describe, expect, it } from 'vitest';
import { normalizeReportMarkdown } from '../index';

describe('full-bold-to-quote auto-fixer', () => {
  it('converts a ≥6-word full-bold paragraph to a blockquote', () => {
    const md = [
      '## Compensation',
      '',
      '**The base is below market but equity upside is real here.**',
      '',
    ].join('\n');
    const out = normalizeReportMarkdown(md).markdown;
    expect(out).toContain('> The base is below market but equity upside is real here.');
    expect(out).not.toContain('**The base is below market but equity upside is real here.**');
  });

  it('leaves a partial-bold `**Label** rest` line untouched', () => {
    const md = ['**Strongest signal** the team ships weekly and owns the roadmap.', ''].join('\n');
    expect(normalizeReportMarkdown(md).markdown).toBe(md);
  });

  it('leaves a short (<6-word) full-bold label untouched', () => {
    const md = ['**Apply now before Friday**', ''].join('\n');
    expect(normalizeReportMarkdown(md).markdown).toBe(md);
  });

  it('does not touch a full-bold line inside a callout div', () => {
    const md = [
      '<div data-callout data-variant="info">',
      '',
      '**This whole sentence lives inside a callout body block.**',
      '',
      '</div>',
      '',
    ].join('\n');
    const out = normalizeReportMarkdown(md).markdown;
    expect(out).toContain('**This whole sentence lives inside a callout body block.**');
  });

  it('still converts a full-bold paragraph that follows a single-line callout', () => {
    // Regression: a single-line `<div data-callout ...>Body.</div>` opens and
    // closes on one line. An open-only depth counter would stay stuck > 0 and
    // silently skip every later takeaway. The single-line callout body itself
    // must stay untouched; the later full-bold paragraph must still convert.
    const md = [
      '<div data-callout data-variant="success" data-emoji="✅">Apply this week before the role closes.</div>',
      '',
      '## Compensation',
      '',
      '**The base is below market but the equity upside is genuinely real here.**',
      '',
    ].join('\n');
    const out = normalizeReportMarkdown(md).markdown;
    expect(out).toContain(
      '<div data-callout data-variant="success" data-emoji="✅">Apply this week before the role closes.</div>',
    );
    expect(out).toContain(
      '> The base is below market but the equity upside is genuinely real here.',
    );
    expect(out).not.toContain('**The base is below market');
  });

  it('does not touch a full-bold line inside fenced code', () => {
    const md = [
      '```md',
      '**This is a fenced full bold sentence with many words.**',
      '```',
      '',
    ].join('\n');
    expect(normalizeReportMarkdown(md).markdown).toBe(md);
  });

  it('is idempotent — a converted blockquote is never re-processed', () => {
    const md = [
      '## Level & strategy',
      '',
      '**Pitch yourself one level up given the scope they described.**',
      '',
    ].join('\n');
    const once = normalizeReportMarkdown(md).markdown;
    expect(normalizeReportMarkdown(once).markdown).toBe(once);
  });

  it('does not convert a bold-led heading or list item', () => {
    const md = ['- **This list item is fully bold and has many words here.**', ''].join('\n');
    expect(normalizeReportMarkdown(md).markdown).toBe(md);
  });
});
