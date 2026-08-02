import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf-8');

// React surfaces whose SVGs are interaction/status icons, not brand artwork,
// charts, or progress-ring geometry. They should render the installed Lucide
// components instead of maintaining hand-copied path data.
const REACT_ICON_SOURCES = [
  'src/components/primitives/select.tsx',
  'src/components/save-state-text.tsx',
  'src/components/toast/toaster.tsx',
  'src/features/analytics/date-range-picker.tsx',
  'src/features/analytics/stat-grid.tsx',
  'src/features/chat/chat-composer.tsx',
  'src/features/chat/chat-header.tsx',
  'src/features/chat/chat-jobs-slot.tsx',
  'src/features/chat/chat-transcript.tsx',
  'src/features/chat/message-view.tsx',
  'src/features/chat/thinking-block.tsx',
  'src/features/chat/tool-card.tsx',
  'src/features/profile/profile-page.tsx',
  'src/features/profile/sections/apply-section.tsx',
  'src/features/profile/sections/_widgets/chip-list.tsx',
  'src/features/profile/sections/_widgets/row-list.tsx',
  'src/features/report/components/running-mode-view.tsx',
  'src/features/report/report-page.tsx',
  'src/features/report/sections/report-attachments.tsx',
  'src/features/report/sections/report-hero.tsx',
  'src/features/settings/settings-page.tsx',
  'src/features/settings/sections/portals-section.tsx',
  'src/features/settings/sections/providers-section.tsx',
  'src/features/table/table-filters.tsx',
];

describe('Lucide icon contract', () => {
  it.each(REACT_ICON_SOURCES)('%s does not hand-draw React control icons', path => {
    expect(read(path)).not.toMatch(/<svg(?:\s|>)/);
  });

  it('does not use text glyphs as interactive or status icons', () => {
    const sources = [
      ...REACT_ICON_SOURCES,
      'src/features/chat/confirm-card.tsx',
      'src/features/table/filter-pills.tsx',
      'src/features/home/agenda-cards.tsx',
      'src/lib/analytics/compute.ts',
      'src/lib/job-types.ts',
    ];
    for (const path of sources) {
      const source = read(path);
      expect(source, path).not.toMatch(/>\s*[×✕✓✗⃠↑↓‹›▲▼▤]\s*</u);
      expect(source, path).not.toMatch(/['"`][✓✕✗⃠⌕⇪]/u);
    }
  });

  it('keeps custom SVG exceptions limited to non-control visuals', () => {
    const bubble = read('src/features/chat/chat-bubble.tsx');
    expect(bubble).toContain('<MessageSquare');
    expect(bubble).not.toContain('lucide message-square glyph (inline SVG');

    // These inline SVGs are data visualizations or progress geometry, not
    // substitute icon artwork.
    expect(bubble).toContain('chat-bubble__ring');
    expect(read('src/features/report/sections/report-snapshot.tsx')).toContain('radarMarkup');
  });

  it('sizes the Radix select icon on the SVG itself', () => {
    const styles = read('src/app/styles/chrome.css');

    expect(styles).toMatch(/\.select-trigger__icon,\s*\.select-scroll-button svg/);
    expect(styles).not.toContain('.select-trigger__icon svg');
  });
});
