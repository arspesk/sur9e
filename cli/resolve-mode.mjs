#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// cli/resolve-mode.mjs
//
// Resolution-only shim around the provider registry, for callers that
// can't import the .ts module directly (plain `node` .mjs scripts, bash).
//
// Invocation MUST go through `tsx --conditions=react-server` because
// src/lib/server/providers/registry.ts is gated by `import 'server-only'`,
// which throws under any condition other than `react-server`. The recommended
// shape is:
//
//     npx tsx --conditions=react-server cli/resolve-mode.mjs <modeId>          # JSON
//     npx tsx --conditions=react-server cli/resolve-mode.mjs <modeId> --shell  # bash eval
//
// The `--shell` flag emits bash variable assignments so callers can avoid a
// jq dependency:
//
//     RESOLVED_PROVIDER=claude
//     RESOLVED_MODEL=claude-sonnet-4-6
//
// Default (no flag) prints {"provider":"claude","model":"...","resolvedFrom":"..."}
// for Node callers that want the structured form.
//
// Why this exists instead of buildHeadlessArgs: the
// adapter's buildHeadlessArgs is shaped to match command-registry's exact
// invocation (stream-json + parser pipe), which is NOT what screen.mjs or
// batch-runner.sh use. Those callers need provider/model resolution only,
// and keep their own CLI-arg shape.

import { resolveModeRuntime } from '../src/lib/server/providers/registry.ts';

function normalizeModeId(id) {
  return id === 'outreach' ? 'reach-out' : id;
}

const [, , rawModeId, ...rest] = process.argv;
const modeId = normalizeModeId(rawModeId);
if (!rawModeId) {
  console.error('Usage: resolve-mode.mjs <modeId> [--shell] [--platform <id> --model <id>]');
  console.error('  Must be invoked via: tsx --conditions=react-server');
  process.exit(2);
}

const shellMode = rest.includes('--shell');

// Per-run override forwarding. When the orchestrator
// (command-registry / batch worker) is spawning this shim with a
// specific provider:model pinned via `--platform` + `--model`, pass
// them as Level-1 runOverride so the waterfall doesn't re-read
// config.yml (which would silently substitute the global default for
// modes that don't have an explicit per-mode setting). Mirrors the
// runOverride param wired through runner.ts.
function parseRunOverride(args) {
  const p = args.indexOf('--platform');
  const m = args.indexOf('--model');
  if (p < 0 || m < 0) return undefined;
  const platform = args[p + 1];
  const model = args[m + 1];
  if (typeof platform !== 'string' || !platform) return undefined;
  if (typeof model !== 'string' || !model) return undefined;
  return { platform, model };
}

let runtime;
try {
  runtime = resolveModeRuntime(process.cwd(), modeId, parseRunOverride(rest));
} catch (err) {
  console.error(`resolve-mode: ${err?.message ?? err}`);
  process.exit(3);
}

if (shellMode) {
  // Emit shell-safe variable assignments. The values come from the registry
  // which already runs them through ProviderModelRef.parse() (regex-validated:
  // ^[a-z][a-z0-9-]*$ for provider, ^[a-z][a-z0-9._:/-]*$ for model), so they
  // can't carry shell-special characters. Still quote defensively.
  process.stdout.write(`RESOLVED_PROVIDER='${runtime.provider}'\n`);
  process.stdout.write(`RESOLVED_MODEL='${runtime.model}'\n`);
  process.stdout.write(`RESOLVED_FROM='${runtime.resolvedFrom}'\n`);
  // Fallback pair (per-mode → global → none). Same regex-validated provenance
  // as the primary, so the values can't carry shell-special characters; still
  // quoted defensively. Emitted only when a fallback resolved.
  if (runtime.fallback) {
    process.stdout.write(`RESOLVED_FALLBACK_PROVIDER='${runtime.fallback.provider}'\n`);
    process.stdout.write(`RESOLVED_FALLBACK_MODEL='${runtime.fallback.model}'\n`);
  }
} else {
  process.stdout.write(
    `${JSON.stringify({
      provider: runtime.provider,
      model: runtime.model,
      resolvedFrom: runtime.resolvedFrom,
      fallback: runtime.fallback ?? null,
    })}\n`,
  );
}
