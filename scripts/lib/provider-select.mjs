// scripts/lib/provider-select.mjs
// SPDX-License-Identifier: MIT
// Pure interpretation of providers-probe JSON. No I/O, no prompts.

// Per-provider model preferences, matched against the provider's available
// model ids. `default` (also used for batch-evaluate) prefers a mid/capable
// model; `screen` prefers a cheap/fast model. Both fall back to the first
// available model so a provider with an off-list set still gets valid ids.
const PREFERENCES = {
  claude: { default: /sonnet/i, screen: /haiku/i },
  codex: { default: /gpt-5|o4|sonnet/i, screen: /mini|nano|haiku/i },
  opencode: { default: /sonnet/i, screen: /haiku|mini|flash/i },
};

export function pickModels(providerId, models) {
  const ids = models.map(m => m.id);
  // Fail loud rather than write a config with no model — an empty list would
  // otherwise leave the model keys undefined and silently fall back to Claude
  // at runtime (resolveModeRuntime level 5), so a non-Claude pick runs on Claude.
  if (ids.length === 0) {
    throw new Error(
      `No models available for provider "${providerId}" — cannot write a valid config.`,
    );
  }
  const pref = PREFERENCES[providerId] || { default: /.*/, screen: /.*/ };
  const find = re => ids.find(id => re.test(id));
  const def = find(pref.default) || ids[0];
  const screen = find(pref.screen) || def;
  return { default: def, screen, batchEvaluate: def };
}

function statusLabel(entry, id) {
  if (!entry.installed.ok) return `${id} (not installed)`;
  return entry.authed.ok ? `${id} (ready)` : `${id} (installed — needs auth)`;
}

export function selectProvider(probe) {
  const ids = Object.keys(probe);
  const ready = ids.filter(id => probe[id].installed.ok && probe[id].authed.ok);
  const installed = ids.filter(id => probe[id].installed.ok);
  // preselect = the best default to highlight in the picker (the wizard always
  // shows the picker; it never auto-selects, so the user always sees every
  // provider's status and chooses).
  return {
    ready,
    installed,
    preselect: ready[0] || installed[0] || 'claude',
    options: ids.map(id => ({ id, label: statusLabel(probe[id], id) })),
  };
}
