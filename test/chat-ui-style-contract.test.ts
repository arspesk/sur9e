import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('chat UI style contract', () => {
  it('aligns the chat header border with the shared app topbar', () => {
    const pageCss = readFileSync(join(root, 'src/app/styles/chat-page.css'), 'utf8');
    const threadsCss = readFileSync(join(root, 'src/app/styles/chat-threads.css'), 'utf8');

    expect(pageCss).toMatch(
      /\.chat-page__header\s*\{[\s\S]*?height:\s*var\(--topbar-h\);[\s\S]*?padding:\s*0 var\(--space-4\)/,
    );
    expect(threadsCss).toMatch(
      /\.chat-threads__head\s*\{[\s\S]*?height:\s*calc\(var\(--topbar-h\) - var\(--space-2\) - var\(--space-1\) - 1px\)/,
    );
  });

  it('uses the approved thread width and the offers-table resize affordance', () => {
    const pageCss = readFileSync(join(root, 'src/app/styles/chat-page.css'), 'utf8');
    const threadsCss = readFileSync(join(root, 'src/app/styles/chat-threads.css'), 'utf8');

    expect(pageCss).toMatch(
      /grid-template-columns:\s*var\(--chat-thread-width,\s*256px\)\s+minmax\(0,\s*1fr\)/,
    );
    expect(threadsCss).toMatch(/\.chat-threads__resize\s*\{[\s\S]*?width:\s*1px/);
    expect(threadsCss).toMatch(
      /\.chat-threads__resize::before\s*\{[\s\S]*?left:\s*-5px;[\s\S]*?right:\s*-5px/,
    );
    expect(threadsCss).toMatch(
      /\.chat-threads__resize:hover,[\s\S]*?\.chat-threads__resize\.dragging\s*\{[\s\S]*?width:\s*2px/,
    );
  });

  it('gives the cancel icon a restrained branded danger treatment', () => {
    const chatCss = readFileSync(join(root, 'src/app/styles/chat.css'), 'utf8');

    expect(chatCss).toMatch(/\.chat-jobs__cancel\s*\{[\s\S]*?color:\s*var\(--st-danger\)/);
    expect(chatCss).toMatch(
      /\.chat-jobs__cancel:hover\s*\{[\s\S]*?background:\s*var\(--surface-danger-hover\)/,
    );
  });
});
