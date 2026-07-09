// openrouter-pricing.test.ts — verifies the response parser and the
// sync hot-path lookup (`getOpenRouterPrice`). The HTTP refresh path
// (`refreshNow`) is exercised only through the parser; we don't hit
// the live endpoint here.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOpenRouterPrice,
  __testing as orTesting,
  parseOpenRouterModels,
  refreshPricingIfStale,
} from '../openrouter-pricing';

describe('parseOpenRouterModels', () => {
  it('converts USD-per-token strings to USD-per-Mtok numbers', () => {
    const raw = {
      data: [
        {
          id: 'anthropic/claude-sonnet-4.6',
          pricing: { prompt: '0.000003', completion: '0.000015' },
        },
      ],
    };
    const out = parseOpenRouterModels(raw);
    expect(out.size).toBe(1);
    expect(out.get('anthropic/claude-sonnet-4.6')).toEqual({
      in_per_mtok: 3,
      out_per_mtok: 15,
    });
  });

  it('skips entries without numeric prompt/completion prices', () => {
    const raw = {
      data: [
        { id: 'no-pricing-block' },
        { id: 'half-pricing', pricing: { prompt: '0.001' } },
        { id: 'string-non-numeric', pricing: { prompt: 'free', completion: 'free' } },
        { id: 'valid', pricing: { prompt: '0.000001', completion: '0.000002' } },
      ],
    };
    const out = parseOpenRouterModels(raw);
    expect(out.size).toBe(1);
    expect(out.has('valid')).toBe(true);
  });

  it('throws on a malformed top-level shape', () => {
    expect(() => parseOpenRouterModels({ not_data: [] })).toThrow();
    expect(() => parseOpenRouterModels({ data: 'not-an-array' })).toThrow();
  });
});

describe('getOpenRouterPrice (sync hot path)', () => {
  beforeEach(() => {
    orTesting.reset();
  });

  it('returns null for an unknown id when cache is empty', () => {
    // Empty in-memory map, no cache file at this path → null.
    const r = getOpenRouterPrice('anthropic/claude-sonnet-4.6', '/nonexistent/root');
    expect(r).toBeNull();
  });

  it('returns the cached price when seeded directly', () => {
    orTesting.seedDirect(
      new Map([['openai/gpt-5.5', { in_per_mtok: 5, out_per_mtok: 30 }]]),
      Date.now(),
    );
    const r = getOpenRouterPrice('openai/gpt-5.5', '/any/path');
    expect(r).toEqual({ in_per_mtok: 5, out_per_mtok: 30 });
  });

  it('still returns the seeded price even when cache is past TTL (serves stale)', () => {
    // fetchedAt set to 30 days ago — well past the 24h TTL. The lookup
    // should still return the stale value (background refresh fires
    // separately; we serve what we have).
    const longAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    orTesting.seedDirect(
      new Map([['z-ai/glm-5.1', { in_per_mtok: 0.98, out_per_mtok: 3.08 }]]),
      longAgo,
    );
    const r = getOpenRouterPrice('z-ai/glm-5.1', '/any/path');
    expect(r).toEqual({ in_per_mtok: 0.98, out_per_mtok: 3.08 });
  });
});

describe('refreshPricingIfStale (job-launch freshness trigger)', () => {
  let root: string;

  beforeEach(() => {
    orTesting.reset();
    root = mkdtempSync(join(tmpdir(), 'sur9e-orcache-'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  it('does NOT fetch when the cache is within TTL', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    orTesting.seedDirect(new Map([['x/y', { in_per_mtok: 1, out_per_mtok: 2 }]]), Date.now());

    refreshPricingIfStale(root);

    expect(orTesting.state().inFlight).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fires a background refresh when the cache is past TTL, landing live prices', async () => {
    // Simulate a model listed on OpenRouter AFTER the last cache write.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'anthropic/claude-sonnet-5',
            pricing: { prompt: '0.000002', completion: '0.00001' },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const longAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    orTesting.seedDirect(new Map([['stale/model', { in_per_mtok: 9, out_per_mtok: 9 }]]), longAgo);

    refreshPricingIfStale(root);

    // Fired synchronously (non-blocking), then settles to a fresh cache.
    expect(orTesting.state().inFlight).toBe(true);
    await vi.waitFor(() => expect(orTesting.state().inFlight).toBe(false));
    expect(fetchMock).toHaveBeenCalledOnce();
    // The just-listed model now resolves live instead of missing.
    expect(getOpenRouterPrice('anthropic/claude-sonnet-5', root)).toEqual({
      in_per_mtok: 2,
      out_per_mtok: 10,
    });
  });
});
