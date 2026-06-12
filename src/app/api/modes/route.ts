// src/app/api/modes/route.ts
//
// GET /api/modes — the user-facing mode catalogue + each mode's default
// (platform, model, exec) used by the Settings → Providers & Models
// per-mode override table. Mirrors `/api/providers`
// in shape but reads the front-matter manifest instead of probing
// child processes.
//
// Why a route (not a Server Component prop): the Settings form is a
// client component (rhf + Zod), so the per-mode table needs a hook it
// can call from the browser. Exposing the manifest behind a TanStack
// Query (`useModeManifest`) matches the existing `useProviderInfo`
// pattern and lets us cache it across navigations.
//
// The `screen` mode has no content/modes/screen.md file but IS a real
// mode in the command-registry (Haiku-rated URL screener). We synthesize
// a manifest entry for it so it shows up in the override table.
//
// runtime = 'nodejs' is required: `loadModeManifest` reads files from
// disk via node:fs, which the Edge runtime forbids.

export const runtime = 'nodejs';

import { ROOT } from '@/lib/root';
import type { ModeMetaResponse, ModesResponse } from '@/lib/schemas/modes';
import { loadModeManifest } from '@/lib/server/modes';

export function GET(): Response {
  const manifest = loadModeManifest(ROOT);
  // Strip the `body` field — clients only need the metadata, and the
  // body is multi-KB per mode (would bloat the response by ~50KB).
  const fromManifest: ModeMetaResponse[] = Object.values(manifest)
    .map(m => ({
      modeId: m.modeId,
      exec: m.exec,
      default_platform: m.default_platform,
      default_model: m.default_model,
      needs_tools: m.needs_tools,
    }))
    // `screen` first (the task spec calls for it as the first row of the
    // override table — it's the entry point of the funnel), then stable
    // alphabetical order so the row order is deterministic across reloads
    // (readdirSync is platform-dependent). screen.md gained a real mode
    // file (front-matter + portable prompt) in the multi-provider merge,
    // so the old SYNTHETIC_MODES entry for it is gone.
    .sort((a, b) => {
      if (a.modeId === 'screen') return -1;
      if (b.modeId === 'screen') return 1;
      return a.modeId.localeCompare(b.modeId);
    });

  return Response.json({ modes: fromManifest } satisfies ModesResponse);
}
