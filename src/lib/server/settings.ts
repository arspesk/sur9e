// src/lib/server/settings.ts
//
// Load + save inputs/config/config.yml. Inlined from settings.mjs.
// Always returns a fully-populated SettingsShape — zod schema defaults
// handle missing/partial files. Async signatures preserved
// (api/settings/route.ts awaits both calls).
//
// NOTE on behavior vs legacy .mjs: the .mjs did `deepMerge(DEFAULTS, parsed)`,
// which preserved YAML keys that didn't appear in the schema. The strict
// SettingsShape.parse() drops unknown keys at the boundary — matches the
// zod policy ("parse at the edges; internal call sites assume the typed
// shape"). If a user adds a key to config.yml that isn't in the
// schema, it gets stripped on the next load/save. To preserve a key,
// add it to lib/schemas/settings.ts.

import 'server-only';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import yaml from 'js-yaml';
import { DEFAULT_SETTINGS, SettingsShape } from '../schemas/settings';
import { atomicWrite } from './atomic-write';
import { describeParseError } from './parse-error';
import { readFileOrNull } from './read-or-null';

export type { SettingsShape as SettingsShapeType } from '../schemas/settings';
export { DEFAULT_SETTINGS, SettingsShape };

// Backwards-compat alias for callers that imported DEFAULTS from the .mjs.
export const DEFAULTS = DEFAULT_SETTINGS;

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  if (!override || typeof override !== 'object') return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Drop NaN leaves from a partial before merging. react-hook-form's
// valueAsNumber yields NaN for a cleared number input; the debounced
// auto-save can ship that mid-edit. NaN means "field is empty right now",
// not "set this to NaN" — treat it as no-change.
export function stripNaNLeaves(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'number' && Number.isNaN(v)) continue;
    // Arrays pass through by reference — SettingsShape has no number[] fields today.
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stripNaNLeaves(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Lift the pre-2026-06 group layout into the new one BEFORE the strict
// parse. Old → new: ui→appearance (density dropped — dead config),
// advanced.{models,modes,default_provider,default_model}→providers.*,
// advanced.system→system, advanced.screening.{parallel_workers,timeout_ms}
// flatten into advanced. New-shape keys always win over lifted old ones,
// so a half-migrated file is safe. Files migrate on disk on first save.
export function liftLegacyGroups(raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return raw;
  const out: Record<string, unknown> = { ...raw };

  const ui = out.ui as Record<string, unknown> | undefined;
  if (ui && typeof ui === 'object') {
    const appearance = (out.appearance as Record<string, unknown> | undefined) ?? {};
    if (appearance.theme == null && ui.theme != null) {
      out.appearance = { ...appearance, theme: ui.theme };
    } else if (out.appearance == null) {
      out.appearance = appearance;
    }
  }
  delete out.ui; // density dies here

  const adv = out.advanced as Record<string, unknown> | undefined;
  if (adv && typeof adv === 'object') {
    const advOut: Record<string, unknown> = { ...adv };

    const providers = { ...((out.providers as Record<string, unknown> | undefined) ?? {}) };
    for (const k of ['models', 'modes', 'default_provider', 'default_model'] as const) {
      if (providers[k] == null && advOut[k] != null) providers[k] = advOut[k];
      delete advOut[k];
    }
    if (Object.keys(providers).length > 0) out.providers = providers;

    const advSystem = advOut.system as Record<string, unknown> | undefined;
    if (advSystem && typeof advSystem === 'object' && out.system == null) {
      out.system = { ...advSystem };
    }
    delete advOut.system;

    const advScreening = advOut.screening as Record<string, unknown> | undefined;
    if (advScreening && typeof advScreening === 'object') {
      if (advOut.parallel_workers == null && advScreening.parallel_workers != null) {
        advOut.parallel_workers = advScreening.parallel_workers;
      }
      if (advOut.timeout_ms == null && advScreening.timeout_ms != null) {
        advOut.timeout_ms = advScreening.timeout_ms;
      }
    }
    delete advOut.screening;

    out.advanced = advOut;
  }
  return out;
}

// Migrate legacy user-supplied advanced.models.{screen,batch} string entries
// into the new providers.modes map. Reads legacy values
// from the RAW YAML providers group (not the schema-parsed shape) so the
// schema's own defaults for `models` don't trigger spurious migrations on a
// missing/empty config — only keys the user actually wrote get migrated. Only
// fills `modes` entries the user hasn't already set explicitly, so re-running
// the migration is a no-op. The legacy providers.models keys stay in place for
// one release (rollback safety).
function migrateLegacyModels(
  parsed: SettingsShape,
  rawProviders: Record<string, unknown> | undefined,
): SettingsShape {
  const rawModels =
    rawProviders && typeof rawProviders === 'object'
      ? (rawProviders.models as Record<string, unknown> | undefined)
      : undefined;
  if (!rawModels) return parsed;
  const migrated = { ...parsed.providers.modes };
  if (typeof rawModels.screen === 'string' && !migrated.screen) {
    migrated.screen = { platform: 'claude', model: rawModels.screen };
  }
  if (typeof rawModels.batch === 'string' && !migrated['batch-evaluate']) {
    migrated['batch-evaluate'] = { platform: 'claude', model: rawModels.batch };
  }
  return { ...parsed, providers: { ...parsed.providers, modes: migrated } };
}

// Parse raw YAML into a fully-populated SettingsShape. Throws on YAML
// syntax errors and schema failures — callers decide whether to fall back
// to defaults (loadSettings) or refuse to proceed (saveSettings).
function parseSettings(raw: string): SettingsShape {
  const lifted = liftLegacyGroups((yaml.load(raw) as Record<string, unknown>) || {});
  const rawProviders = lifted.providers as Record<string, unknown> | undefined;
  return migrateLegacyModels(SettingsShape.parse(lifted), rawProviders);
}

export interface SettingsLoadError {
  /** Path of the unreadable file (as given to the loader). */
  path: string;
  /** Short human-readable cause (YAML reason or zod `path: message` pairs). */
  message: string;
  /** 1-based YAML error line, when the parser knows it. */
  line: number | null;
}

export interface SettingsLoadResult {
  /** Fully-populated settings — ALL DEFAULTS when `error` is set. */
  settings: SettingsShape;
  /** Set only when the file EXISTS but failed to parse (YAML or schema). */
  error: SettingsLoadError | null;
}

// Structured fail-soft loader: a missing file is a normal fresh install
// (defaults, no error); an existing-but-unparseable file still degrades to
// defaults for read paths, but carries an explicit error so /settings can
// say "your config was ignored" instead of silently rendering defaults.
export async function loadSettingsResult(path: string): Promise<SettingsLoadResult> {
  const raw = readFileOrNull(path);
  if (raw == null) return { settings: SettingsShape.parse({}), error: null };
  try {
    return { settings: parseSettings(raw), error: null };
  } catch (err) {
    const { message, line } = describeParseError(err);
    console.warn(`[settings] failed to parse ${path}: ${message}`);
    return { settings: SettingsShape.parse({}), error: { path, message, line } };
  }
}

export async function loadSettings(path: string): Promise<SettingsShape> {
  return (await loadSettingsResult(path)).settings;
}

// saveSettings accepts a deep-partial of SettingsShape — deep-merges into
// existing settings so callers can supply only the leaves they want to update.
// Typing it as `unknown` keeps existing call sites (Settings UI, /api/settings
// PATCH) shape-compatible without forcing them to fill every sibling key.
//
// Special-case: `providers.modes` AND `providers.models` are REPLACED
// wholesale (not deep-merged) whenever they
// appear in the patch. The Settings form's per-mode override table sends
// the COMPLETE intended set of overrides on every save — a row absent from
// the patch means "no override for that mode", and a deep-merge would
// silently resurrect a row the user just cleared via "Use default". The
// same wholesale-replace applies to the legacy `providers.models` map (only
// `screen` + `batch` aliases) so that clearing a legacy key via the
// sanitizer (which strips empty strings) actually takes effect on disk —
// without it, the on-load migration in `migrateLegacyModels` would
// re-synthesize the corresponding `providers.modes.{screen,batch-evaluate}`
// row on the next read. All other paths keep deep-merge semantics
// (load-bearing for other settings sections + partial PATCH callers).
//
// Special-case (fallback off): a present-but-NULL `providers.fallback` in the
// patch is the explicit "delete the global fallback" sentinel (sanitizeForSave
// in use-settings-form.ts emits it when the user picks "None"). The key is
// removed from the merged config before validation, so the persisted YAML
// simply lacks it — SettingsShape keeps `fallback` strictly optional (never
// null on disk). An ABSENT key stays a deep-merge no-op, so partial PATCH
// callers that don't mention fallback leave the on-disk pair untouched.
export async function saveSettings(path: string, partial: unknown): Promise<SettingsShape> {
  // Distinguish "file missing" (proceed from defaults) from "file exists but
  // unparseable" (refuse). loadSettings falls back to all-defaults on a parse
  // failure, which is fine for reads — but writing that fallback back to disk
  // would silently replace every hand-edited setting with defaults the moment
  // any save fires (silent data loss; the .bak rotates away on the next save).
  const raw = readFileOrNull(path);
  let existing: SettingsShape;
  if (raw == null) {
    existing = SettingsShape.parse({});
  } else {
    try {
      existing = parseSettings(raw);
    } catch (err) {
      // describeParseError keeps the message banner-sized (zod issue list
      // instead of the raw JSON dump; YAML reason without the code frame).
      throw new Error(
        `refusing to save settings: ${path} exists but failed to parse (${describeParseError(err).message}). ` +
          'Fix or remove the file first — saving now would overwrite it with defaults.',
      );
    }
  }
  const liftedPartial = stripNaNLeaves(
    liftLegacyGroups((partial || {}) as Record<string, unknown>),
  );
  const merged = deepMerge(existing as unknown as Record<string, unknown>, liftedPartial);
  const partialProviders = liftedPartial.providers as Record<string, unknown> | undefined;
  if (partialProviders && 'modes' in partialProviders) {
    (merged.providers as Record<string, unknown>).modes = partialProviders.modes as Record<
      string,
      unknown
    >;
  }
  if (partialProviders && 'models' in partialProviders) {
    (merged.providers as Record<string, unknown>).models = partialProviders.models as Record<
      string,
      unknown
    >;
  }
  // Null sentinel → delete (deepMerge copied the null into the merged tree;
  // leaving it would fail the strict FallbackRef parse below).
  if (partialProviders && 'fallback' in partialProviders && partialProviders.fallback == null) {
    delete (merged.providers as Record<string, unknown>).fallback;
  }
  // Validate BEFORE writing — a bad partial (e.g. NaN from a cleared number
  // input racing the debounced save) must never reach disk: a file with
  // `.nan` makes loadSettings fall back to all-defaults (silent data loss).
  const validated = SettingsShape.parse(merged);
  mkdirSync(dirname(path), { recursive: true });
  atomicWrite(path, yaml.dump(validated, { indent: 2, lineWidth: 100, noRefs: true }));
  return validated;
}
