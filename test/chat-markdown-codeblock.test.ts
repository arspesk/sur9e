import { describe, expect, it } from 'vitest';
import { renderChatMarkdown } from '@/features/chat/chat-markdown';

describe('renderChatMarkdown code blocks', () => {
  it('wraps fenced code in a copy-button container and escapes the code', () => {
    const html = renderChatMarkdown('```js\nconst a = "<b>";\n```');
    expect(html).toContain('class="chat-codeblock"');
    expect(html).toContain('chat-codeblock__copy');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain('language-js');
    expect(html).toContain('&lt;b&gt;');
  });

  it('leaves inline code untouched', () => {
    const html = renderChatMarkdown('use `npm run scan` here');
    expect(html).toContain('<code>npm run scan</code>');
    expect(html).not.toContain('chat-codeblock');
  });
});
