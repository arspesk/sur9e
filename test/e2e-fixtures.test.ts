import { describe, expect, it } from 'vitest';
import { withoutFencedCode } from './e2e/markdown-fixtures';

describe('report fixture Markdown filtering', () => {
  it('excludes headings inside tilde fences', () => {
    expect(withoutFencedCode('~~~markdown\n## hidden\n~~~\n## visible')).toBe('## visible');
  });

  it('does not close a longer backtick fence with a shorter inner fence', () => {
    expect(
      withoutFencedCode('````markdown\n## hidden\n```\n## still hidden\n````\n## visible'),
    ).toBe('## visible');
  });

  it('preserves unfenced Markdown unchanged', () => {
    const markdown = '# Report\n\n## First\nText\n## Second';
    expect(withoutFencedCode(markdown)).toBe(markdown);
  });
});
