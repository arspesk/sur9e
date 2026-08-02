import { existsSync, readFileSync } from 'node:fs';
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
  it('owns the Lucide glyph choice in one shared OverflowMenuButton primitive', () => {
    const path = join(ROOT, 'src/components/primitives/overflow-menu-button.tsx');
    expect(existsSync(path)).toBe(true);
    const source = readFileSync(path, 'utf-8');
    expect(source).toContain('EllipsisVertical');
    expect(source).toContain('Ellipsis');
    expect(source).toContain('<IconButton');
  });

  it.each(KEBAB_SOURCES)('%s uses the shared vertical menu-button contract', path => {
    const source = read(path);
    expect(source).toContain('<OverflowMenuButton');
    expect(source).not.toContain('<EllipsisVertical');
    expect(source).not.toMatch(/>\s*[⋮⋯]\s*</u);
  });

  it.each(MEATBALL_SOURCES)('%s uses the shared horizontal menu-button contract', path => {
    const source = read(path);
    expect(source).toContain('<OverflowMenuButton');
    expect(source).toContain('orientation="horizontal"');
    expect(source).not.toContain('<Ellipsis');
    expect(source).not.toContain('<EllipsisVertical');
  });

  it('sources control icon sizing and strokes from design tokens', () => {
    const tokens = read('src/app/styles/tokens.css');
    expect(tokens).toMatch(/--icon-size-control:\s*16px/);
    expect(tokens).toMatch(/--icon-stroke-default:\s*1\.7/);
    expect(tokens).toMatch(/--icon-stroke-menu:\s*2/);

    const css = read('src/app/styles/chrome.css');
    const iconBlock = css.match(/\.icon-btn\s+svg\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(iconBlock).toMatch(/width:\s*var\(--icon-size-control\)/);
    expect(iconBlock).toMatch(/height:\s*var\(--icon-size-control\)/);
    expect(iconBlock).toMatch(/stroke-width:\s*var\(--icon-stroke-default\)/);

    const menuBlock = css.match(/\.icon-btn\s+svg\.menu-dots-icon\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(menuBlock).toMatch(/stroke-width:\s*var\(--icon-stroke-menu\)/);
    expect(css).not.toMatch(/(?:^|\n)svg\.menu-dots-icon\s*\{/);
  });
});
