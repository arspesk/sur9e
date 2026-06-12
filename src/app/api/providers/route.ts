// src/app/api/providers/route.ts
//
// GET /api/providers — per-provider health + model list for every registered
// CLI provider (claude / codex / opencode). Powers the Settings → Providers &
// Models section (via useProviderInfo) — the CLI status panel + per-mode
// override table both render off this matrix.
//
// Each adapter probe (checkInstalled / checkAuth / listModels) wraps in
// `.catch` so a single broken adapter never poisons the whole response —
// the failing surface shows a degraded state inline instead.
//
// runtime = 'nodejs' is required: the provider adapters spawn child
// processes (execFile against the `claude` / `codex` / `opencode` binaries)
// which the Edge runtime forbids.

export const runtime = 'nodejs';

import type { ProviderId, ProviderInfoEntry, ProvidersResponse } from '@/lib/schemas/providers';
import { PROVIDERS } from '@/lib/server/providers/registry';
import type { ModelChoice, ProviderHealth } from '@/lib/server/providers/types';

export async function GET(): Promise<Response> {
  // Only iterate ids that are actually registered. PROVIDERS is
  // Partial<Record<ProviderId, Provider>> so future renames or removals
  // stay safe at the type level.
  const ids = Object.keys(PROVIDERS) as ProviderId[];

  const entries = await Promise.all(
    ids.map(async id => {
      const p = PROVIDERS[id];
      if (!p) {
        // Defensive — Object.keys narrows to declared keys, but Partial
        // means TS still thinks the lookup could miss. Skip cleanly
        // rather than crashing the whole route.
        return null;
      }
      const [installed, auth, models] = await Promise.all([
        p
          .checkInstalled()
          .catch((err: unknown): ProviderHealth => ({ ok: false, error: String(err) })),
        p.checkAuth().catch((err: unknown): { ok: boolean; warning?: string } => ({
          ok: false,
          warning: String(err),
        })),
        p.listModels().catch((): ModelChoice[] => []),
      ]);
      const entry: ProviderInfoEntry = {
        id,
        displayName: p.displayName,
        binary: p.binary,
        installHint: p.installHint,
        installed,
        auth,
        models,
      };
      return [id, entry] as const;
    }),
  );

  const providers: Record<string, ProviderInfoEntry> = Object.fromEntries(
    entries.filter((e): e is readonly [ProviderId, ProviderInfoEntry] => e !== null),
  );

  return Response.json({ providers } satisfies ProvidersResponse);
}
