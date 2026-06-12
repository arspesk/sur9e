// src/lib/server/favicon.ts
//
// Server-side favicon proxy backing /api/favicon. Company logos for screened
// offers are derived from Google's favicon endpoint (batch/screen.mjs), which
// 404s for any domain it hasn't cached — and the browser logs a console error
// for every cross-origin 404 an <img> or fetch() touches. Fetching the icon
// here (same process, no CORS) lets the route answer 200-with-image on a hit
// and a silent 204 on a miss, so the client console stays clean.
//
// Results — including misses — are memoized per process: a local app sees a
// bounded set of company domains, so a plain Map is enough.
//
// server-only: uses fetch with AbortSignal against an external host and must
// never end up in a client bundle.

import 'server-only';

export interface FaviconHit {
  bytes: ArrayBuffer;
  contentType: string;
}

// Hostnames only: labels of [a-z0-9-] joined by dots, no scheme/path/port.
// Keeps the upstream query param honest (the host itself is always Google).
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const UPSTREAM_TIMEOUT_MS = 5000;

const iconCache = new Map<string, Promise<FaviconHit | null>>();

export function isValidFaviconDomain(domain: string): boolean {
  return domain.length <= 253 && DOMAIN_RE.test(domain);
}

async function fetchUpstream(domain: string): Promise<FaviconHit | null> {
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.startsWith('image/')) return null;
    return { bytes: await res.arrayBuffer(), contentType };
  } catch {
    // Offline / timeout — report a miss; the avatar falls back to initials.
    return null;
  }
}

/** Cached favicon lookup; `null` means a verified miss (or upstream failure). */
export function loadFavicon(domain: string): Promise<FaviconHit | null> {
  let hit = iconCache.get(domain);
  if (!hit) {
    hit = fetchUpstream(domain);
    iconCache.set(domain, hit);
  }
  return hit;
}

/** Test seam: clear the per-process memo between cases. */
export function clearFaviconCache(): void {
  iconCache.clear();
}
