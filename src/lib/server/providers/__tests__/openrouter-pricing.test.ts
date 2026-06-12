// openrouter-pricing.test.ts — verifies the response parser and the
// sync hot-path lookup (`getOpenRouterPrice`). The HTTP refresh path
// (`refreshNow`) is exercised only through the parser; we don't hit
// the live endpoint here.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getOpenRouterPrice,
  __testing as orTesting,
  parseOpenRouterModels,
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
