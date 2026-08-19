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
