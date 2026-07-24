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
  // KNOWN BUILD FOOTGUN (verified 2026-06-04): `next build` panics on any
  // symlink inside the project tree whose target escapes the repo ("Symlink …
  // points out of the filesystem root" — vercel/next.js#88335). Turbopack
  // enumerates the WHOLE project dir during ModuleGraph::create; there is no
  // config escape (outputFileTracingExcludes does not gate it) and no code fix
  // (it is structural, independent of any module). The JobSpy venv's bin/python
  // is such a symlink, and `python -m venv --copies` is refused by framework
  // Pythons — so the venv is created OUTSIDE the repo (batch/lib/jobspy-venv.mjs)
  // and the build never sees it. A leftover in-tree batch/jobspy-env from an
  // older install still trips this; `npm run setup` removes it.
  // next.config.ts is build-time only — it must never land in a route's runtime
  // output-file trace. Server loaders join runtime-opaque roots
  // (join(process.cwd(), …)), which makes Turbopack's tracer over-trace and pull
  // next.config.ts into the NFT list ("Encountered unexpected file in NFT list").
  // Excluding it kills that warning class; it has no runtime effect (sur9e runs
  // `next start`, not standalone output).
  outputFileTracingExcludes: { '*': ['next.config.ts'] },
  // Compile-time route safety. In Next 16 this option has been
  // promoted out of `experimental` to a top-level flag. Build emits typed
  // route definitions to `.next/types/` so <Link href> / router.push /
  // redirect() reject unknown routes at typecheck time.
  typedRoutes: true,
  // NOT enabling experimental.viewTransition. It only switches on React's
  // <ViewTransition> component, which react@19.2 stable does not export (it
  // ships in experimental builds only) — so the flag alone never calls
  // document.startViewTransition and the navigation stays a hard cut.
  // Verified 2026-07-24: flag on + matching view-transition-names on both
  // composers = zero transitions fired. The Home→/chat "expand" is therefore
  // done with CSS in chat-page.css. Revisit if React promotes the API.
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
