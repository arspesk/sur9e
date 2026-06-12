// src/lib/server/__tests__/favicon.test.ts
//
// The favicon proxy lib: domain validation (the only user-controlled input
// reaching the upstream query param) and the hit/miss/memoization contract
// behind /api/favicon. Upstream fetch is stubbed — no network.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFaviconCache, isValidFaviconDomain, loadFavicon } from '../favicon';

afterEach(() => {
  clearFaviconCache();
  vi.unstubAllGlobals();
});

describe('isValidFaviconDomain', () => {
  it('accepts plain hostnames', () => {
    expect(isValidFaviconDomain('example.com')).toBe(true);
    expect(isValidFaviconDomain('sub.example-site.co.uk')).toBe(true);
  });
  it('rejects schemes, paths, ports, and traversal-ish input', () => {
    expect(isValidFaviconDomain('https://example.com')).toBe(false);
    expect(isValidFaviconDomain('example.com/path')).toBe(false);
    expect(isValidFaviconDomain('example.com:8080')).toBe(false);
    expect(isValidFaviconDomain('../etc/passwd')).toBe(false);
    expect(isValidFaviconDomain('')).toBe(false);
    expect(isValidFaviconDomain('no-dot')).toBe(false);
  });
});

describe('loadFavicon', () => {
  it('returns bytes + content type on an image hit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    );
    const hit = await loadFavicon('hit.example');
    expect(hit?.contentType).toBe('image/png');
    expect(new Uint8Array(hit?.bytes ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('returns null when upstream 404s or serves non-image content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    expect(await loadFavicon('miss.example')).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
        ),
    );
    expect(await loadFavicon('html.example')).toBeNull();
  });

  it('returns null when upstream fetch rejects (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await loadFavicon('down.example')).toBeNull();
  });

  it('memoizes per domain — one upstream fetch for repeated lookups', async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([9]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    vi.stubGlobal('fetch', upstream);
    await loadFavicon('memo.example');
    await loadFavicon('memo.example');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
