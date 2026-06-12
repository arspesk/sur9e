// src/lib/server/same-origin.ts
//
// Same-origin guard for state-changing route handlers — the Origin-vs-Host
// check the update endpoints (api/update/apply, api/update/rollback) already
// enforce, extracted so job-spawn POST routes can share it. Cross-site pages
// can fire CORS "simple request" POSTs (no preflight) at this local server;
// without this check a drive-by page can spawn token-spending jobs.
//
// Returns a 403 Response to short-circuit with, or null to proceed. Browsers
// always send Origin on cross-origin POSTs; a missing header means a same-
// origin or non-browser caller (curl, scripts) and is allowed through.

import 'server-only';

export function rejectCrossOrigin(req: Request): Response | null {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin) return null;
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // Unparseable Origin (e.g. the literal "null" from sandboxed/opaque
    // origins) — treat as cross-origin.
    originHost = null;
  }
  if (originHost !== host) {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}
