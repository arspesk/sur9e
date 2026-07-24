import { describe, expect, it } from 'vitest';
import { renderChatMarkdown } from '@/features/chat/chat-markdown';

// Coverage for every markdown element the assistant emits, so a Tailwind
// Preflight-style global reset (which strips heading sizes + list markers)
// can't silently break rendering again. These assert the HTML STRUCTURE marked
// produces; the visual restore lives in .chat-md rules in chat.css.
describe('renderChatMarkdown — element coverage', () => {
  it('headings h1-h3', () => {
    const html = renderChatMarkdown('# One\n\n## Two\n\n### Three');
    expect(html).toContain('<h1>One</h1>');
    expect(html).toContain('<h2>Two</h2>');
    expect(html).toContain('<h3>Three</h3>');
  });

  it('a heading interrupts a paragraph with no blank line (model output style)', () => {
    const html = renderChatMarkdown('Some intro line.\n## Findings\nMore text.');
    expect(html).toContain('<h2>Findings</h2>');
  });

  it('bold, italic, and inline code', () => {
    const html = renderChatMarkdown('This is **bold**, *italic*, and `code`.');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('blockquote', () => {
    const html = renderChatMarkdown('> a quoted line');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('a quoted line');
  });

  it('links get href + target/rel hardening', () => {
    const html = renderChatMarkdown('See [sur9e](https://sur9e.com).');
    expect(html).toContain(
      '<a href="https://sur9e.com" target="_blank" rel="noreferrer noopener">sur9e</a>',
    );
  });

  it('unsafe link scheme is neutralized', () => {
    const html = renderChatMarkdown('[x](javascript:alert(1))');
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });

  it('fenced code block uses the copy-button wrapper', () => {
    const html = renderChatMarkdown('```js\nconst a = 1;\n```');
    expect(html).toContain('chat-codeblock');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('const a = 1;');
  });

  it('nested bullet list is preserved', () => {
    const html = renderChatMarkdown('\n- parent\n    - child\n');
    expect(html).toMatch(/<ul>[\s\S]*<ul>[\s\S]*child[\s\S]*<\/ul>[\s\S]*<\/ul>/);
  });

  it('ordered + unordered lists both render (no-blank-line model output)', () => {
    const html = renderChatMarkdown('Intro:\n- one\n- two\nNext:\n1. a\n2. b');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect((html.match(/<li>/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('thematic break (hr)', () => {
    const html = renderChatMarkdown('above\n\n---\n\nbelow');
    expect(html).toContain('<hr>');
  });

  it('raw HTML in prose is escaped, never injected', () => {
    const html = renderChatMarkdown('a <script>alert(1)</script> b');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('table is wrapped in the horizontal-scroll container', () => {
    const html = renderChatMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<div class="chat-md__table-scroll"><table>');
    expect(html).toContain('</table></div>');
  });

  it('a full realistic reply (no blank lines) renders all block types', () => {
    const md = [
      '## Summary',
      'Here is the state:',
      '**Pipeline is dry.** Nothing new.',
      '| # | Company |',
      '|---|---|',
      '| 81 | LangChain |',
      'Plus a note after the table.',
      '**Next steps:**',
      '1. Run a scan.',
      '2. Batch-evaluate.',
      '> Tip: focus on the 3.9s.',
    ].join('\n');
    const html = renderChatMarkdown(md);
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<strong>Pipeline is dry.</strong>');
    // the line after the table is a paragraph, not swallowed as a table row
    expect((html.match(/<tr>/g) ?? []).length).toBe(2);
    expect(html).toContain('Plus a note after the table.');
  });
});
