import path from 'node:path';
import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';

// Visualize first-load JS per route to find dynamic-import wins.
// Toggle with `ANALYZE=true npm run build` (no-op otherwise).
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  serverExternalPackages: ['js-yaml', 'playwright'],
  // Dev-only Next.js indicator badge: the default bottom-left position sits
  // exactly on top of the mobile bottom-nav's first tab ("Offers") at ≤640px
  // and overlaps the rail's Settings item on desktop. Bottom-right is
  // unoccupied at every width (toasts/job deck anchor above it).
  devIndicators: { position: 'bottom-right' },
  // Tailnet dev access: scripts/web.mjs --tailscale exports the machine's
  // tailnet hostname; without it Next's cross-origin dev protection 403s
  // /_next assets + the HMR websocket through the tailscale proxy, which
  // breaks hydration entirely (dead buttons, no client-side data).
  ...(process.env.SUR9E_TAILNET_HOST
    ? { allowedDevOrigins: [process.env.SUR9E_TAILNET_HOST] }
    : {}),
  // KNOWN BUILD FOOTGUN (verified 2026-06-04): `next build` panics if
  // batch/jobspy-env contains symlinks resolving outside the repo
  // ("Symlink … points out of the filesystem root" — vercel/next.js#88335).
  // Turbopack traces the whole project dir (server code joins runtime-opaque
  // roots) and there is NO config escape — outputFileTracingExcludes was
  // tested and does not gate module-graph traversal. Fix: create the venv
  // with `python3 -m venv --copies batch/jobspy-env` so bin/* are copies,
  // not symlinks.
  // Compile-time route safety. In Next 16 this option has been
  // promoted out of `experimental` to a top-level flag. Build emits typed
  // route definitions to `.next/types/` so <Link href> / router.push /
  // redirect() reject unknown routes at typecheck time.
  typedRoutes: true,
  // DEFERRED: Next 16.2.6 merged `experimental.ppr` into a new
  // top-level `cacheComponents` API with different semantics. The original
  // PPR rollout (per-route `experimental_ppr` opt-in) is no longer valid —
  // needs a fresh audit against the cacheComponents model before re-enabling.
  // (The original route-candidacy analysis — mostly-static shells are PPR
  // candidates — still applies once the new API is wired.)
  images: {
    // Allow next/image to serve SVG brand assets (icon-logo, wordmarks, favicon).
    // Content-Security-Policy restricts scripts so inline SVG attack surface is
    // contained. Do NOT loosen this for user-uploaded content.
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  turbopack: {
    // Pin the workspace root to THIS directory so Turbopack doesn't scan
    // parent directories (which include sandboxed Library paths on macOS).
    root: path.resolve(__dirname),
  },
};

export default withBundleAnalyzer(nextConfig);
