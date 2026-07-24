import { describe, expect, it } from 'vitest';
import { preprocessChatMarkdown, renderChatMarkdown } from '@/features/chat/chat-markdown';

// Count how many `<tr>` rows a rendered table has (thead + tbody combined).
const rowCount = (html: string) => (html.match(/<tr>/g) ?? []).length;

describe('renderChatMarkdown block boundaries (preprocessor)', () => {
  it('(a) table immediately followed by two paragraph lines does not absorb them as rows', () => {
    const md = [
      '| # | Company |',
      '|---|---|',
      '| 1 | Acme |',
      'This is a note.',
      'Second line.',
    ].join('\n');
    const html = renderChatMarkdown(md);
    // The table has exactly a header row + one data row — 2 <tr>, not 4.
    expect(rowCount(html)).toBe(2);
    expect(html).toContain('<td>1</td>');
    // The trailing prose escaped the table and lives outside it.
    expect(html).toContain('This is a note.');
    expect(html).not.toContain('<td>This is a note.</td>');
    expect(html).not.toContain('<td>Second line.</td>');
  });

  it('(b) a `|...|` table not preceded by a blank line still renders as a <table>', () => {
    const md = ['Here are the results:', '| # | Company |', '|---|---|', '| 1 | Acme |'].join('\n');
    const html = renderChatMarkdown(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Company</th>');
    expect(html).toContain('<td>Acme</td>');
    // Not rendered as literal pipe text.
    expect(html).not.toContain('| # | Company |');
  });

  it('(c) a paragraph immediately followed by `- item` lines renders a <ul><li>', () => {
    const md = ['Consider these:', '- first', '- second'].join('\n');
    const html = renderChatMarkdown(md);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
    expect(html).not.toContain('- first');
  });

  it('(c2) 4-space-indented bullets under a paragraph de-indent into a real list', () => {
    const md = ['Consider these:', '    - first', '    - second'].join('\n');
    const html = renderChatMarkdown(md);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
    // The accidental indentation must not survive as literal text.
    expect(html).not.toContain('- first');
    expect(html).not.toContain('<br>');
  });

  it('(d) a fenced code block containing `| pipes |` is not turned into a table', () => {
    const md = ['```', '| not | a table |', '|---|---|', '```'].join('\n');
    const html = renderChatMarkdown(md);
    expect(html).not.toContain('<table>');
    expect(html).toContain('| not | a table |');
    expect(html).toContain('class="chat-codeblock"');
  });

  it('preserves an intentional nested list (does not flatten child items)', () => {
    const md = ['- parent', '    - child a', '    - child b'].join('\n');
    const out = preprocessChatMarkdown(md);
    // The 4-space child indentation is retained, so marked nests them.
    expect(out).toContain('    - child a');
    expect(out).toContain('    - child b');
    const html = renderChatMarkdown(md);
    // A nested <ul> lives inside the parent <li>.
    expect(html).toMatch(/<li>parent<ul>/);
  });

  it('wraps a table in a horizontal-scroll container', () => {
    const html = renderChatMarkdown(['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n'));
    expect(html).toContain('<div class="chat-md__table-scroll"><table>');
    expect(html).toContain('</table></div>');
  });

  it('does not disturb prose that already has correct blank-line separation', () => {
    const md = 'A paragraph.\n\n- one\n- two\n\nAnother paragraph.';
    const out = preprocessChatMarkdown(md);
    expect(out).toBe(md);
  });
});
