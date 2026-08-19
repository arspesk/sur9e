// test/home-layout-contract.test.ts
//
// Issue #93 regression guard: .home lives directly in the column-flex .main,
// where its auto inline margins suppress flex stretch — the container then
// shrink-wraps to content. Loaded pages mask that (real content is wide);
// the route skeleton's fixed-size bars collapsed it to ~440px. The fix pins
// width: 100%; this contract keeps the pin paired with the auto margins.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('home layout contract (#93)', () => {
  it('.home pins width: 100% alongside its auto inline margins', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/styles/home-inline.css'), 'utf-8');
    const homeRule = css.match(/\.home\s*\{[^}]*\}/)?.[0] ?? '';
    expect(homeRule).toContain('margin-inline: auto');
    expect(homeRule, '.home must pin width so it cannot shrink-wrap (#93)').toContain(
      'width: 100%',
    );
  });
});

describe('page width tokens (#93 consistency)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

  it('tokens.css owns the three shared page widths', () => {
    const tokens = read('src/app/styles/tokens.css');
    expect(tokens).toMatch(/--page-w:\s*1040px/);
    expect(tokens).toMatch(/--reading-w:\s*768px/);
    expect(tokens).toMatch(/--hero-w:\s*700px/);
  });

  it('every centered page column consumes the shared tokens, never a raw cap', () => {
    const consumers: Array<[string, RegExp[]]> = [
      [
        'src/app/styles/home-inline.css',
        [/\.home\s*\{[^}]*max-width:\s*var\(--page-w\)/, /var\(--hero-w\)/],
      ],
      ['src/app/styles/chat-page.css', [/var\(--reading-w\)/]],
      ['src/app/styles/analytics-inline.css', [/var\(--page-w\)/]],
      ['src/app/styles/settings-inline.css', [/var\(--page-w\)/, /padding-inline: 88px/]],
      ['src/app/styles/profile-inline.css', [/var\(--page-w\)/, /padding-inline: 88px/]],
      ['src/app/styles/chrome.css', [/var\(--page-col,\s*var\(--page-w\)\)/]],
    ];
    for (const [file, patterns] of consumers) {
      const css = read(file);
      for (const pattern of patterns)
        expect(css, `${file} should match ${pattern}`).toMatch(pattern);
      // No page-column magic numbers left behind in these files.
      expect(css, `${file} still has a raw page cap`).not.toMatch(
        /max-width:\s*(?:820|880|960|1040|1140)px/,
      );
      // TOC-rail gutters must be symmetric — a lone right gutter skews the
      // centered column (the settings/profile 32-vs-88 bug).
      expect(css, `${file} has an asymmetric rail gutter`).not.toMatch(/padding-right:\s*88px/);
    }
  });
});
