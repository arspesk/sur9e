// src/lib/server/providers/registry.ts
//
// Provider registry + resolveModeRuntime — the central dispatcher entry-points
// for the multi-CLI layer.
//
// `PROVIDERS` maps ProviderId → concrete Provider adapter. The `codex` and
// `opencode` adapters slot in here alongside `claude`. The `Partial<Record>` is deliberate so the type
// stays honest about which keys are populated; `getProvider` throws a
// "not yet implemented" error for unset ids rather than crashing on `undefined`.
//
// `resolveModeRuntime` is the 5-level waterfall every job spawn flows through.
// Highest-to-lowest priority:
//
//   1. run override      — passed in at call time (launch dialog quick-pick)
//   2. per-mode setting  — providers.modes[modeId] in inputs/config/config.yml
//   3. global default    — providers.default_provider/default_model
//   4. mode front-matter — default_platform/default_model on content/modes/<id>.md
//   5. hardcoded fallback — claude + claude-sonnet-4-6
//
// Caching: we keep a module-level `configCache` for the raw config.yml read.
// This is distinct from the React `cache()` on `loadModeManifest` because
// config.yml reads happen outside the React render context (from Server
// Actions and the job runner), so per-render memoisation is not enough.
// Tests bust the cache via `clearProvidersCache()` between fixtures.
//
// Why not reuse loadSettings(): loadSettings runs the full SettingsShape zod
// schema, which lives in src/lib/server/settings.ts and would create a
// circular dep when that schema is extended with `advanced.modes`.
// `loadConfigShallow` reads only the small subset of keys the waterfall
// needs and treats malformed YAML as "empty config" — a deliberately
// forgiving boundary so a half-edited config.yml can never block resolution.
//
// server-only: spawns no children itself, but lives alongside adapters that
// do — keeping the guard prevents accidental client-bundle inclusion.

import 'server-only';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { ProviderId, ProviderModelRef } from '../../schemas/providers';
import { loadModeManifest } from '../modes';
import claude from './claude';
import codex from './codex';
import opencode from './opencode';
import type { Provider } from './types';

export const PROVIDERS: Partial<Record<ProviderId, Provider>> = {
  claude,
  codex,
  opencode,
};

export function getProvider(id: ProviderId): Provider {
  const p = PROVIDERS[id];
  if (!p) {
    throw new Error(
      `Provider "${id}" not yet implemented. Available: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  return p;
}

export type ModeRuntime = {
  provider: ProviderId;
  model: string;
  exec: 'headless' | 'interactive' | 'both';
  resolvedFrom: 'run_override' | 'mode_setting' | 'mode_default' | 'global_default' | 'fallback';
  // Fallback pair retried once by runModeLLM when the primary fails for a
  // retryable category (cli/classify-error.mjs). Resolution mirrors the
  // primary waterfall: per-mode fallback → global fallback → undefined.
  // Dropped when identical to the resolved primary. Independent of where
  // the primary resolved from (including run overrides).
  fallback?: { provider: ProviderId; model: string };
};

export type RunOverride = { platform: ProviderId; model: string };

// Lightweight per-process cache for the raw config.yml content. Tests bust
// this via clearProvidersCache(). NOTE: distinct from the React cache() on
// loadModeManifest — config.yml reads happen outside the React render
// context (from Server Actions and the job runner), so we need our own
// cache here.
// Cache is keyed on rootPath AND the config.yml mtime, so an edit to the file
// — via the Settings UI, a direct hand-edit, or a git checkout — is picked up
// on the next read without an explicit clear. Long-lived processes (the Next
// dev/prod server) would otherwise serve a stale model
// after the user re-pins a mode, while freshly-spawned job workers read the
// new value — the exact split that made the confirmation modal disagree with
// the actual run.
let configCache: { rootPath: string; raw: unknown; mtimeMs: number } | null = null;
export function clearProvidersCache(): void {
  configCache = null;
}

function configMtimeMs(rootPath: string): number {
  try {
    return statSync(join(rootPath, 'inputs/config/config.yml')).mtimeMs;
  } catch {
    return 0; // missing file — a stable sentinel so the cache still keys cleanly
  }
}

// Normalize whatever shape is on disk into the NEW `providers.*` group
// (in-memory only — settings.ts owns the on-disk migration):
//  1. Lift advanced.{models,modes,default_provider,default_model} into
//     providers.* (explicit providers.* keys win — unmigrated files only
//     have advanced.*, migrated files only have providers.*).
//  2. Synthesize legacy models.<id> scalars into modes.<id> rows
//     ({platform:'claude', model}) — user's explicit modes.<id> wins.
//
// Mirrors the migration in src/lib/server/settings.ts but stays in-memory:
// settings.ts rewrites config.yml on disk (loadSettings path); registry.ts
// has its own cache because the job-spawn path uses loadConfigShallow
// directly and never goes through loadSettings — so without this helper,
// users with legacy keys for the 6 modes not covered by the settings
// migration (evaluate, research, outreach, tailor-cv, cover-letter,
// interview-prep) would silently downgrade to the hardcoded fallback
// (claude-sonnet-4-6) until they re-save settings.
function normalizeProvidersInto(raw: Record<string, unknown>): Record<string, unknown> {
  const advanced = (raw.advanced as Record<string, unknown>) ?? {};
  const providers = { ...((raw.providers as Record<string, unknown>) ?? {}) };
  for (const k of ['models', 'modes', 'default_provider', 'default_model'] as const) {
    if (providers[k] == null && advanced[k] != null) providers[k] = advanced[k];
  }
  // Note: advanced.* is deliberately left in place (unlike settings.ts's
  // liftLegacyGroups, which strips it) — the waterfall only reads providers.*.
  const legacyModels = (providers.models as Record<string, string | undefined>) ?? {};
  const currentModes =
    (providers.modes as Record<string, { platform?: string; model?: string }>) ?? {};
  const merged = { ...currentModes };
  for (const [modeId, modelStr] of Object.entries(legacyModels)) {
    if (typeof modelStr !== 'string' || !modelStr) continue;
    const targetId = modeId === 'batch' ? 'batch-evaluate' : modeId;
    if (merged[targetId]) continue; // user's explicit override wins
    merged[targetId] = { platform: 'claude', model: modelStr };
  }
  return { ...raw, providers: { ...providers, modes: merged } };
}

function loadConfigShallow(rootPath: string): Record<string, unknown> {
  const mtimeMs = configMtimeMs(rootPath);
  if (configCache && configCache.rootPath === rootPath && configCache.mtimeMs === mtimeMs) {
    return (configCache.raw ?? {}) as Record<string, unknown>;
  }
  const p = join(rootPath, 'inputs/config/config.yml');
  let raw: Record<string, unknown> = {};
  if (existsSync(p)) {
    try {
      raw = (yaml.load(readFileSync(p, 'utf-8')) as Record<string, unknown>) ?? {};
    } catch {
      // Malformed YAML → treat as empty config. Surfacing the parse error
      // from this code path would block resolution mid-edit; the settings
      // page is the right place to report YAML errors.
      raw = {};
    }
  }
  // Normalize legacy advanced.* keys and synthesize models.<id> scalars into
  // providers.modes.<id> rows BEFORE caching, so the early-return on
  // subsequent calls sees the normalized shape.
  const synthesized = normalizeProvidersInto(raw);
  configCache = { rootPath, raw: synthesized, mtimeMs };
  return synthesized;
}

// Resolve the fallback pair for a mode: per-mode fallback → global fallback
// → undefined. Forgiving boundary like the rest of loadConfigShallow:
// malformed entries (missing field, bad model id) are ignored rather than
// thrown — a broken fallback must never block primary resolution.
function resolveFallback(
  cfg: Record<string, unknown>,
  modeId: string,
  primary: { provider: string; model: string },
): ModeRuntime['fallback'] {
  const providers = (cfg.providers as Record<string, unknown>) ?? {};
  const modeRow = ((providers.modes as Record<string, Record<string, unknown>>) ?? {})[modeId];
  for (const candidate of [modeRow?.fallback, providers.fallback]) {
    const fb = candidate as { platform?: unknown; model?: unknown } | undefined;
    if (!fb || typeof fb.platform !== 'string' || typeof fb.model !== 'string') continue;
    const parsedPlatform = ProviderId.safeParse(fb.platform);
    const parsedModel = ProviderModelRef.safeParse(fb.model);
    if (!parsedPlatform.success || !parsedModel.success) continue;
    if (parsedPlatform.data === primary.provider && parsedModel.data === primary.model) continue;
    return { provider: parsedPlatform.data, model: parsedModel.data };
  }
  return undefined;
}

export function resolveModeRuntime(
  rootPath: string,
  modeId: string,
  runOverride?: RunOverride,
): ModeRuntime {
  const cfg = loadConfigShallow(rootPath);
  const withFallback = (base: Omit<ModeRuntime, 'fallback'>): ModeRuntime => ({
    ...base,
    fallback: resolveFallback(cfg, modeId, base),
  });

  // Level 1: per-run override (launch dialog / topbar quick-pick).
  if (runOverride?.platform && runOverride?.model) {
    return withFallback({
      provider: runOverride.platform,
      model: ProviderModelRef.parse(runOverride.model),
      exec: pickExec(rootPath, modeId),
      resolvedFrom: 'run_override',
    });
  }

  const providers = (cfg.providers as Record<string, unknown>) ?? {};
  const modeOverrides =
    (providers.modes as Record<string, { platform?: string; model?: string }>) ?? {};
  const mo = modeOverrides[modeId];

  // Level 2: user-set per-mode override in config.yml.
  if (mo?.platform && mo?.model) {
    return withFallback({
      provider: mo.platform as ProviderId,
      model: ProviderModelRef.parse(mo.model),
      exec: pickExec(rootPath, modeId),
      resolvedFrom: 'mode_setting',
    });
  }

  // Level 3: global default from config — the USER's explicit Settings
  // choice. Outranks the mode author's front-matter: once a global
  // platform+model is set, it applies to every mode without a per-mode
  // override. Front-matter defaults (level 4) only matter on installs
  // that never set a global default — out-of-box tuning, not a pin.
  const gp = providers.default_provider as ProviderId | undefined;
  const gm = providers.default_model as string | undefined;
  if (gp && gm) {
    return withFallback({
      provider: gp,
      model: ProviderModelRef.parse(gm),
      exec: pickExec(rootPath, modeId),
      resolvedFrom: 'global_default',
    });
  }

  const manifest = loadModeManifest(rootPath);
  const m = manifest[modeId];

  // Level 4: mode author's front-matter default (no global default set).
  if (m?.default_platform && m?.default_model) {
    return withFallback({
      provider: m.default_platform,
      model: ProviderModelRef.parse(m.default_model),
      exec: m.exec,
      resolvedFrom: 'mode_default',
    });
  }

  // Level 5: hardcoded fallback. claude-sonnet-4-6 is sur9e's canonical
  // "always works" combination — the binary is a hard dep, the model id
  // is in claude.ts's STATIC_MODELS list. Re-parsed for consistency even
  // though the literal is known-safe.
  return withFallback({
    provider: 'claude',
    model: ProviderModelRef.parse('claude-sonnet-4-6'),
    exec: pickExec(rootPath, modeId),
    resolvedFrom: 'fallback',
  });
}

// Subtle: if a mode has no front-matter entry in the manifest (unknown
// modeId, or a mode file without a YAML block), exec defaults to
// 'interactive'. This matches the loader fallback in
// src/lib/schemas/modes.ts (`ModeFrontMatterDefaults.exec === 'interactive'`).
function pickExec(rootPath: string, modeId: string): ModeRuntime['exec'] {
  const m = loadModeManifest(rootPath)[modeId];
  return m?.exec ?? 'interactive';
}
