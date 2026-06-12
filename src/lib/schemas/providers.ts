// lib/schemas/providers.ts
//
// zod schemas for the provider-adapter layer (Phase 2). Three pieces:
//
//   ProviderId         — enum of the supported CLI providers
//                        (claude, codex, opencode). The canonical
//                        id that resolveModeRuntime + getProvider key off.
//
//   ProviderModelRef   — shell-safe model id. Allows Claude bare ids
//                        (claude-sonnet-4-6) AND OpenCode
//                        provider-prefixed ids (anthropic/claude-3-haiku,
//                        openrouter/moonshotai/kimi-k2.6). Forbids any
//                        character that could escape an argv slot if a
//                        caller ever bypasses spawn's args array.
//
//   UnifiedStreamEvent — the shared event shape every provider's NDJSON
//                        parser emits. Upstream UI/stage code only ever
//                        sees this shape, so swapping providers stays a
//                        pure adapter swap.
//
// Strict shape: parsed at the provider boundary, trusted downstream.

import { z } from 'zod';

export const ProviderId = z.enum(['claude', 'codex', 'opencode']);
export type ProviderId = z.infer<typeof ProviderId>;

// Allows Claude bare ids (claude-sonnet-4-6), OpenCode provider-prefixed ids
// (anthropic/claude-3-haiku, openrouter/moonshotai/kimi-k2.6), and the literal
// `[1m]` context-window suffix the Claude CLI accepts as a --model input
// (claude-opus-4-7[1m]) — listModels deliberately surfaces those variants in
// the picker. Forbids any other char that could escape a shell argument when
// spawn's `args` array is bypassed ('[' / ']' are inert inside single quotes).
export const ProviderModelRef = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._/-]{0,115}(\[1m\])?$/i, 'invalid model id');
export type ProviderModelRef = z.infer<typeof ProviderModelRef>;

export const UnifiedStreamEvent = z.object({
  kind: z.enum(['stage', 'tool', 'thinking', 'tokens', 'error', 'final']),
  message: z.string(),
  tokens: z
    .object({
      in: z.number().int().nonnegative(),
      out: z.number().int().nonnegative(),
      model: z.string(),
      estimated: z.boolean().optional(),
    })
    .optional(),
  ts: z.string(),
});
export type UnifiedStreamEvent = z.infer<typeof UnifiedStreamEvent>;

// ── /api/providers response contract ─────────────────────────────────────────
// Shared by the route handler (src/app/api/providers/route.ts) and the
// useProviderInfo hook so the client/server contract lives in the schema
// layer, not in the app/ surface. Type-only imports from lib/server are
// erased at build time, so this stays client-safe.

import type { ModelChoice, ProviderHealth } from '../server/providers/types';

export interface ProviderInfoEntry {
  id: ProviderId;
  displayName: string;
  binary: string;
  installHint: string;
  installed: ProviderHealth;
  auth: { ok: boolean; warning?: string };
  models: ModelChoice[];
}

export interface ProvidersResponse {
  providers: Record<string, ProviderInfoEntry>;
}
