import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf-8');

const KEBAB_SOURCES = [
  'src/features/pipeline/board-card.tsx',
  'src/features/table/table-row-actions.tsx',
  'src/features/home/followups-section.tsx',
  'src/features/home/pending-offers-section.tsx',
  'src/features/chat/session-menu.tsx',
  'src/features/chat/chat-threads-sidebar.tsx',
];

const MEATBALL_SOURCES = [
  'src/features/report/report-page.tsx',
  'src/features/table/offers-drawer.tsx',
];

describe('menu dots icon contract', () => {
  it.each(KEBAB_SOURCES)('%s uses the canonical vertical Lucide kebab', path => {
    const source = read(path);
    expect(source).toContain('<EllipsisVertical');
    expect(source).toContain('className="menu-dots-icon"');
    expect(source).not.toMatch(/>\s*[⋮⋯]\s*</u);
  });

  it.each(MEATBALL_SOURCES)('%s uses the canonical horizontal Lucide meatball', path => {
    const source = read(path);
    expect(source).toContain('<Ellipsis');
    expect(source).not.toContain('<EllipsisVertical');
    expect(source).toContain('className="menu-dots-icon"');
  });

  it('keeps both glyph orientations at the shared 16px / 2px-stroke size', () => {
    const css = read('src/app/styles/chrome.css');
    const block = css.match(/\.menu-dots-icon\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toMatch(/width:\s*16px/);
    expect(block).toMatch(/height:\s*16px/);
    expect(block).toMatch(/stroke-width:\s*2/);
  });
});
