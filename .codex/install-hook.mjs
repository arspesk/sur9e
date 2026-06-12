#!/usr/bin/env node
// Registers the sur9e Codex Stop hook into the USER-LEVEL ~/.codex/config.toml.
//
// Why user-level and not repo-local: hooks declared in a repo-local
// .codex/config.toml do NOT fire in interactive Codex sessions
// (openai/codex#17532). Only ~/.codex/config.toml is honored, so that's where
// we write.
//
// The edit is idempotent: re-running won't duplicate the block, and existing
// config is preserved (we only append our own [[hooks.Stop]] section). Run:
//
//   node .codex/install-hook.mjs
//
// Override the target config (used by tests) with CODEX_CONFIG_PATH.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HOOK_DIR, 'hooks', 'sur9e-track-usage.mjs');

export function defaultConfigPath() {
  return (
    process.env.CODEX_CONFIG_PATH ||
    join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
  );
}

// Build the TOML block that wires the Stop hook to an absolute command path.
// Codex's hooks schema: a [[hooks.Stop]] entry holds one or more
// [[hooks.Stop.hooks]] command entries.
export function buildHookBlock(commandPath) {
  return [
    '',
    '# sur9e — per-turn interactive token spend tracker (managed by .codex/install-hook.mjs)',
    '[[hooks.Stop]]',
    '[[hooks.Stop.hooks]]',
    'type = "command"',
    `command = ${tomlString(commandPath)}`,
    '',
  ].join('\n');
}

// TOML basic-string quoting (the command path is an absolute filesystem path).
function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Idempotency check: has our managed command already been wired in? We match
// on the absolute command path so a second run is a no-op.
export function alreadyInstalled(configText, commandPath) {
  if (typeof configText !== 'string') return false;
  return configText.includes(tomlString(commandPath)) || configText.includes(commandPath);
}

// Pure planner: given the current config text (or null when the file is
// absent) and the command path, return { changed, text } for the desired
// config. Existing content is preserved verbatim; our block is appended.
export function planConfig(currentText, commandPath) {
  const existing = typeof currentText === 'string' ? currentText : '';
  if (alreadyInstalled(existing, commandPath)) {
    return { changed: false, text: existing };
  }
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  return { changed: true, text: existing + sep + buildHookBlock(commandPath) };
}

export function install({ configPath = defaultConfigPath(), commandPath = HOOK_PATH } = {}) {
  const current = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : null;
  const { changed, text } = planConfig(current, commandPath);
  if (changed) {
    if (!existsSync(dirname(configPath))) mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, text);
  }
  return { changed, configPath, commandPath, created: current === null };
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

if (isMain()) {
  const result = install();
  if (result.changed) {
    console.log(
      `${result.created ? 'Created' : 'Updated'} ${result.configPath}\n` +
        `Wired the sur9e Stop hook → ${result.commandPath}`,
    );
  } else {
    console.log(`Already installed in ${result.configPath} (no change).`);
  }
  console.log(
    '\nNote: Codex only fires hooks from the USER-LEVEL ~/.codex/config.toml — a\n' +
      'repo-local .codex/config.toml does NOT fire in interactive sessions\n' +
      '(openai/codex#17532). Running with `--ephemeral` (no rollout file) also\n' +
      'disables tracking, since per-turn usage is read from the session rollout.',
  );
}
