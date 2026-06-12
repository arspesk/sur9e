// usage-tracker-pricing.test.ts — write-side parity for the shared
// model-pricing lookup (spec §3): cli/usage-tracker.mjs prices through the
// SAME chain (OpenRouter cache → name inference → free rule → static
// tables) as the display layer (src/lib/server/providers/pricing.ts), so
// persisted cost_usd and displayed dollars cannot diverge.
//
// All runs go to mkdtemp roots — the real data/usage.json and
// data/openrouter-pricing-cache.json are never touched (mtime paranoia
// check mirrors usage-tracker.test.ts).

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trackProvider } from '../../../../cli/usage-tracker.mjs';
import {
  CLI_EMITTABLE_MODEL_IDS,
  OR_CACHE_FIXTURE,
} from '../providers/__tests__/fixtures/openrouter-cache-fixture';
import { __testing as orTesting } from '../providers/openrouter-pricing';
import { priceForRun } from '../providers/pricing';

const CANONICAL_USAGE_PATH = resolve(__dirname, '../../../../data/usage.json');

const MTOK = 1_000_000;

function makeRoot(withCache: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'usage-tracker-pricing-'));
  mkdirSync(join(root, 'data'));
  if (withCache) {
    writeFileSync(
      join(root, 'data/openrouter-pricing-cache.json'),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        modelsCount: Object.keys(OR_CACHE_FIXTURE).length,
        prices: OR_CACHE_FIXTURE,
      }),
    );
  }
  return root;
}

describe('cli/usage-tracker — shared pricing lookup parity', () => {
  const roots: string[] = [];
  let canonicalMtimeBefore: number | null;

  beforeEach(() => {
    canonicalMtimeBefore = existsSync(CANONICAL_USAGE_PATH)
      ? statSync(CANONICAL_USAGE_PATH).mtimeMs
      : null;
  });

  afterEach(() => {
    while (roots.length) {
      const r = roots.pop();
      if (r) rmSync(r, { recursive: true, force: true });
    }
    const canonicalMtimeAfter = existsSync(CANONICAL_USAGE_PATH)
      ? statSync(CANONICAL_USAGE_PATH).mtimeMs
      : null;
    expect(
      canonicalMtimeAfter,
      'canonical data/usage.json was modified by this test — rootPath plumbing regressed',
    ).toBe(canonicalMtimeBefore);
  });

  it('prices a bare kimi-k2.6 opencode row from the OpenRouter cache file', () => {
    const root = makeRoot(true);
    roots.push(root);
    const result = trackProvider('opencode', MTOK, MTOK, {
      model: 'kimi-k2.6',
      mode: 'evaluate',
      rootPath: root,
    });
    expect(result.cost_usd).toBeCloseTo(0.68 + 3.41, 6);
  });

  it('persists $0 (a real price, not a fabrication) for the deepseek free alias', () => {
    const root = makeRoot(true);
    roots.push(root);
    const result = trackProvider('opencode', MTOK, MTOK, {
      model: 'opencode/deepseek-v4-flash-free',
      rootPath: root,
    });
    expect(result.cost_usd).toBe(0);
  });

  it('write-side cost matches the display layer for every CLI-emittable model (same fixture cache)', () => {
    orTesting.seedDirect(new Map(Object.entries(OR_CACHE_FIXTURE)), Date.now());
    const root = makeRoot(true);
    roots.push(root);
    for (const [provider, model] of CLI_EMITTABLE_MODEL_IDS) {
      const written = trackProvider(provider, MTOK, MTOK, { model, rootPath: root });
      const displayed = priceForRun(provider, model, { in: MTOK, out: MTOK });
      expect(displayed.matched, `${provider}:${model} must price on the display side`).toBe(true);
      expect(
        written.cost_usd,
        `${provider}:${model} write-side cost must equal display-side cost`,
      ).toBeCloseTo(displayed.usd, 6);
    }
  });

  it('falls back to the static tables when the cache file is missing (offline)', () => {
    const root = makeRoot(false);
    roots.push(root);
    // codex gpt-5: static 2.5/10 $/Mtok.
    const codex = trackProvider('codex', MTOK, MTOK, { model: 'gpt-5', rootPath: root });
    expect(codex.cost_usd).toBeCloseTo(12.5, 6);
    // free alias needs no cache either.
    const free = trackProvider('opencode', MTOK, MTOK, {
      model: 'opencode/deepseek-v4-flash-free',
      rootPath: root,
    });
    expect(free.cost_usd).toBe(0);
  });

  it('still refuses to fabricate prices for genuinely unknown codex/opencode models', () => {
    const root = makeRoot(true);
    roots.push(root);
    const unknown = trackProvider('opencode', MTOK, MTOK, {
      model: 'opencode/some-internal-alias',
      rootPath: root,
    });
    expect(unknown.cost_usd).toBe(0);
  });
});
