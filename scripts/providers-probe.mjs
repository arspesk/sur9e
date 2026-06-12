#!/usr/bin/env node
// scripts/providers-probe.mjs
// SPDX-License-Identifier: MIT
// Emit JSON { [providerId]: { installed, authed, models, installHint } } by
// reusing the real provider adapters. MUST be invoked via:
//   npx tsx --conditions=react-server scripts/providers-probe.mjs
// (registry.ts is `import 'server-only'`-gated; see cli/resolve-mode.mjs.)
import { PROVIDERS } from '../src/lib/server/providers/registry.ts';

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const out = {};
for (const [id, provider] of Object.entries(PROVIDERS)) {
  if (!provider) continue;
  const installed = await safe(() => provider.checkInstalled(), { ok: false });
  const authed = installed.ok
    ? await safe(() => provider.checkAuth(), { ok: false })
    : { ok: false };
  // listModels is called unconditionally — adapters (e.g. opencode) return a
  // static fallback list even when the CLI is absent, so a not-installed
  // provider still offers valid model ids the user can pre-commit to.
  const models = await safe(() => provider.listModels(), []);
  // installHint is the exact install command — surfaced so the wizard can tell
  // a no-CLI user how to install the provider they picked.
  out[id] = { installed, authed, models, installHint: provider.installHint };
}

process.stdout.write(JSON.stringify(out));
