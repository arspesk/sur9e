import { describe, expect, it } from 'vitest';
import {
  buildTocFromMarkdown,
  stripInlineMarkdown,
} from '@/features/report/components/report-body-editor';

describe('stripInlineMarkdown', () => {
  it('strips bold markers', () => {
    expect(stripInlineMarkdown('**bold**')).toBe('bold');
  });
  it('strips italic markers', () => {
    expect(stripInlineMarkdown('*italic*')).toBe('italic');
  });
  it('strips double-underscore bold', () => {
    expect(stripInlineMarkdown('__bold__')).toBe('bold');
  });
  it('strips underscore italic', () => {
    expect(stripInlineMarkdown('_italic_')).toBe('italic');
  });
  it('strips inline code', () => {
    expect(stripInlineMarkdown('`code`')).toBe('code');
  });
  it('strips link syntax and keeps label', () => {
    expect(stripInlineMarkdown('[Link](#x)')).toBe('Link');
  });
  it('handles nested bold-italic: **a _b_ c**', () => {
    // outer bold strips first → 'a _b_ c', then italic strips → 'a b c'
    expect(stripInlineMarkdown('**a _b_ c**')).toBe('a b c');
  });
  it('leaves plain text unchanged', () => {
    expect(stripInlineMarkdown('plain text')).toBe('plain text');
  });
  it('trims surrounding whitespace', () => {
    expect(stripInlineMarkdown('  hello  ')).toBe('hello');
  });
});

describe('buildTocFromMarkdown', () => {
  it('returns empty array for empty input', () => {
    expect(buildTocFromMarkdown('')).toEqual([]);
  });

  it('parses a plain h2 heading', () => {
    const toc = buildTocFromMarkdown('## TL;DR\n\nsome body');
    expect(toc).toHaveLength(1);
    expect(toc[0]).toEqual({ id: 'tl-dr', title: 'TL;DR', level: 2 });
  });

  it('strips bold from h3 title and slug', () => {
    const toc = buildTocFromMarkdown('### **bold**\n\ntext');
    expect(toc).toHaveLength(1);
    expect(toc[0].title).toBe('bold');
    expect(toc[0].id).toBe('bold');
  });

  it('handles a realistic bold+numbering heading', () => {
    const toc = buildTocFromMarkdown('### **4c. Coding session (60 min)**');
    expect(toc).toHaveLength(1);
    expect(toc[0].title).toBe('4c. Coding session (60 min)');
    expect(toc[0].id).toBe('4c-coding-session-60-min');
  });

  it('strips link syntax and keeps label', () => {
    const toc = buildTocFromMarkdown('### [Link](#x)');
    expect(toc).toHaveLength(1);
    expect(toc[0].title).toBe('Link');
    expect(toc[0].id).toBe('link');
  });

  it('leaves plain heading unchanged', () => {
    const toc = buildTocFromMarkdown('## plain');
    expect(toc[0].title).toBe('plain');
    expect(toc[0].id).toBe('plain');
  });

  it('de-duplicates identical slugs with numeric suffix', () => {
    const md = '## Foo\n## Foo\n## Foo';
    const toc = buildTocFromMarkdown(md);
    expect(toc).toHaveLength(3);
    expect(toc[0].id).toBe('foo');
    expect(toc[1].id).toBe('foo-2');
    expect(toc[2].id).toBe('foo-3');
  });

  it('collects h1, h2, and h3 levels', () => {
    const md = '# One\n## Two\n### Three';
    const toc = buildTocFromMarkdown(md);
    expect(toc.map(h => h.level)).toEqual([1, 2, 3]);
  });

  it('skips lines that are not headings', () => {
    const toc = buildTocFromMarkdown('not a heading\n\n## Real heading');
    expect(toc).toHaveLength(1);
    expect(toc[0].title).toBe('Real heading');
  });

  it('does not match h4+ headings', () => {
    const toc = buildTocFromMarkdown('#### deep');
    expect(toc).toHaveLength(0);
  });
});
