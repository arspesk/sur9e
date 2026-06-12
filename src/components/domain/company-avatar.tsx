'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

interface CompanyAvatarProps {
  company: string;
  logoUrl?: string;
  /** Extra class hook for size variants, e.g. 'cmk' on the kanban card. */
  className?: string;
  /**
   * Job-posting URL. When set, the avatar becomes a link that opens the
   * posting in a new tab (mirrors the kebab "Open posting" action). When
   * empty/undefined the avatar stays a decorative, non-interactive tile.
   */
  href?: string;
}

const GOOGLE_FAVICON_RE = /^https:\/\/www\.google\.com\/s2\/favicons\?/;

// Module-level memo: domain → promise of an object URL (null on miss). Many
// rows share a company, so each domain is probed once per page lifetime; the
// object URLs live as long as the page, bounded by the set of companies.
const probeCache = new Map<string, Promise<string | null>>();

/** Extract the `domain` param when logoUrl is a derived Google favicon URL. */
function googleFaviconDomain(logoUrl: string): string | null {
  if (!GOOGLE_FAVICON_RE.test(logoUrl)) return null;
  try {
    return new URL(logoUrl).searchParams.get('domain');
  } catch {
    return null;
  }
}

// Persisted probe verdicts: domain → hit/miss, 7-day TTL. Without this,
// every page load re-probes each domain after hydration (one round-trip per
// domain) before any logo can mount — the visible symptom is letter tiles
// lingering, then logos popping in late. With a cached hit verdict the <img>
// mounts immediately at hydration pointing at the proxy URL (whose bytes are
// HTTP-cached for 7 days by /api/favicon); a cached miss skips the fetch
// entirely and keeps the letter.
const VERDICTS_KEY = 'sur9e.favicon.verdicts';
const VERDICT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type VerdictMap = Record<string, { v: 0 | 1; t: number }>;
let verdictsMemo: VerdictMap | null = null;

function readVerdicts(): VerdictMap {
  if (!verdictsMemo) {
    try {
      verdictsMemo = JSON.parse(localStorage.getItem(VERDICTS_KEY) || '{}') as VerdictMap;
    } catch {
      verdictsMemo = {};
    }
  }
  return verdictsMemo;
}

function writeVerdict(domain: string, v: 0 | 1) {
  const map = readVerdicts();
  map[domain] = { v, t: Date.now() };
  try {
    localStorage.setItem(VERDICTS_KEY, JSON.stringify(map));
  } catch {}
}

function cachedVerdict(domain: string): 0 | 1 | null {
  const entry = readVerdicts()[domain];
  if (!entry || Date.now() - entry.t > VERDICT_TTL_MS) return null;
  return entry.v;
}

function proxyFaviconUrl(domain: string): string {
  return `/api/favicon?domain=${encodeURIComponent(domain)}`;
}

// Probe via the same-origin proxy (/api/favicon): 200+image/* on a hit, a
// silent 204 on a miss — fetch() never sees a 4xx, so the console stays
// clean (the browser logs "Failed to load resource" for any 4xx an <img>
// OR a fetch() touches, which is exactly the flood this avoids).
function probeDerivedFavicon(domain: string): Promise<string | null> {
  let probe = probeCache.get(domain);
  if (!probe) {
    probe = fetch(proxyFaviconUrl(domain))
      .then(async res => {
        const type = res.headers.get('content-type') ?? '';
        const hit = res.ok && type.startsWith('image/');
        writeVerdict(domain, hit ? 1 : 0);
        if (!hit) return null;
        return URL.createObjectURL(await res.blob());
      })
      .catch(() => null);
    probeCache.set(domain, probe);
  }
  return probe;
}

// Visibility gate for the probes: with 552 unvirtualized rows, an
// on-mount probe fires one fetch per unique domain (~470 on a cold cache)
// the moment the page hydrates — a request storm against the dev server in
// which *any* navigation logs every still-in-flight probe as a
// `net::ERR_ABORTED` "failure". Deferring each probe until its tile is near
// the viewport keeps the in-flight set at roughly the visible rows;
// scrolling probes the rest on demand. One shared observer for every avatar
// on the page; tiles fire once and are unobserved.
const visibilityCallbacks = new WeakMap<Element, () => void>();
let sharedObserver: IntersectionObserver | null = null;

/** Run `cb` once when `el` is near the viewport. Returns an unsubscribe. */
function onNearViewport(el: Element, cb: () => void): () => void {
  // No IntersectionObserver (jsdom / very old browsers) → probe eagerly,
  // matching the pre-gate behavior.
  if (typeof IntersectionObserver === 'undefined') {
    cb();
    return () => {};
  }
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const fn = visibilityCallbacks.get(entry.target);
          visibilityCallbacks.delete(entry.target);
          sharedObserver?.unobserve(entry.target);
          fn?.();
        }
      },
      // Probe one screenful ahead so logos are usually ready as rows scroll in.
      { rootMargin: '50%' },
    );
  }
  visibilityCallbacks.set(el, cb);
  sharedObserver.observe(el);
  return () => {
    visibilityCallbacks.delete(el);
    sharedObserver?.unobserve(el);
  };
}

// Renders the company logo inside the existing `.company-mark` tile (which
// carries the orange corner-wedge via ::after). Fallback chain: logoUrl ->
// initial letter.
//
// Two logo flavors with different loading strategies:
// - Explicit logo URLs (from the scan source) mount an <img> directly; a
//   broken image flips to the initial via onError.
// - Derived Google-favicon URLs (minted in batch/screen.mjs) 404 for most
//   domains, and every cross-origin 404 an <img> touches logs a console
//   error. Those go through the /api/favicon proxy probe above instead, and
//   the <img> only mounts once the probe resolves with real image bytes.
export function CompanyAvatar({ company, logoUrl, className, href }: CompanyAvatarProps) {
  const [broken, setBroken] = useState(false);
  const [probedSrc, setProbedSrc] = useState<string | null>(null);
  // Tile element (span or a) — the visibility gate observes it.
  const tileRef = useRef<HTMLElement | null>(null);
  const initial = (company || '?').trim().charAt(0).toUpperCase();
  const derivedDomain = logoUrl ? googleFaviconDomain(logoUrl) : null;

  useEffect(() => {
    setProbedSrc(null);
    if (!derivedDomain) return;
    // Cached verdict short-circuit: a known hit mounts the proxy URL
    // immediately (bytes come from the HTTP cache — no probe round-trip),
    // a known miss keeps the letter without any network at all. Only
    // unknown/expired domains pay the probe — and only once the tile is
    // near the viewport (see onNearViewport).
    const verdict = cachedVerdict(derivedDomain);
    if (verdict === 0) return;
    if (verdict === 1) {
      setProbedSrc(proxyFaviconUrl(derivedDomain));
      return;
    }
    let active = true;
    const startProbe = () => {
      probeDerivedFavicon(derivedDomain).then(url => {
        if (active && url) setProbedSrc(url);
      });
    };
    const el = tileRef.current;
    const unobserve = el ? onNearViewport(el, startProbe) : (startProbe(), () => {});
    return () => {
      active = false;
      unobserve();
    };
  }, [derivedDomain]);

  const src = derivedDomain ? probedSrc : logoUrl && !broken ? logoUrl : null;
  const inner = src ? (
    // Decorative (alt="") — the link variant's aria-label / the static
    // variant's aria-hidden wrapper carry the semantics.
    // loading="lazy" matters for the verdict-cached proxy path: all 552 rows
    // mount their <img> at hydration, and without it the browser fires every
    // byte request up front (~417 on a warm cache) — the same
    // navigate-mid-storm ERR_ABORTED noise the probe gate avoids. Lazy defers
    // offscreen tiles to scroll time; blob: object URLs are unaffected.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => {
        // A failing verdict-cached proxy img means the cache went stale —
        // drop back to the letter and let the next load re-probe.
        if (derivedDomain) {
          writeVerdict(derivedDomain, 0);
          setProbedSrc(null);
        }
        setBroken(true);
      }}
    />
  ) : (
    initial
  );

  // Interactive variant: the whole tile is an external link to the posting.
  // stopPropagation so a click on the avatar inside a clickable table row /
  // kanban card opens the posting instead of the drawer.
  if (href) {
    return (
      <a
        ref={tileRef as React.Ref<HTMLAnchorElement>}
        className={cn('company-mark', 'company-mark--link', className)}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${company || 'job'} posting in a new tab`}
        title="Open job posting"
        onClick={e => e.stopPropagation()}
      >
        {inner}
      </a>
    );
  }

  return (
    <span
      ref={tileRef as React.Ref<HTMLSpanElement>}
      className={cn('company-mark', className)}
      aria-hidden="true"
    >
      {inner}
    </span>
  );
}
