#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// cli/build-claude-cmd.mjs
//
// Command-building shim around the provider registry +
// `buildHeadlessArgs`. Resolves the
// runtime for a mode AND constructs the full eval-safe bash command line
// the caller should execute. Sibling to `cli/resolve-mode.mjs`, which only
// resolves provider/model; this one additionally builds the command.
//
// Two separate shims keep responsibilities clean:
//   - resolve-mode.mjs → "what provider + model?"
//   - build-claude-cmd.mjs → "what is the full claude -p invocation?"
//
// Invocation (always via tsx --conditions=react-server because
// providers/registry.ts is gated by `import 'server-only'`):
//
//   npx tsx --conditions=react-server cli/build-claude-cmd.mjs <modeId> \
//     [--prompt <inline>] [--prompt-file <path>] \
//     [--append-system-prompt-file <path>] \
//     [--output-format stream-json|json|text] \
//     [--tools T1,T2,...] \
//     [--no-pipe] \
//     [--no-skip-permissions] \
//     [--json]
//
// Default: prints the inner bash command (the `args[1]` of buildHeadlessArgs)
// on stdout — exactly what `eval "$(node cli/build-claude-cmd.mjs ...)"` needs.
//
// `--json`: prints `{"cmd":"/bin/bash","args":["-c","claude -p ..."]}` so
// Node callers (e.g. batch/screen.mjs) can pass it straight to spawn()
// without going through bash eval.
//
// All registered adapters (claude / codex / opencode)
// are valid here; each adapter throws from its own support matrix when an
// option doesn't apply, so misuse surfaces as a clear exit-3 error.

import { readFileSync } from 'node:fs';
import { getProvider, resolveModeRuntime } from '../src/lib/server/providers/registry.ts';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (
      a === '--prompt' ||
      a === '--prompt-file' ||
      a === '--append-system-prompt-file' ||
      a === '--output-format' ||
      a === '--tools' ||
      a === '--platform' ||
      a === '--model'
    ) {
      const v = argv[++i];
      if (v == null || v.startsWith('--')) {
        console.error(`build-claude-cmd: flag ${a} needs a value`);
        process.exit(2);
      }
      out[a] = v;
    } else if (a === '--no-pipe' || a === '--no-skip-permissions' || a === '--json') {
      out[a] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const [, , ...rest] = process.argv;
const opts = parseArgs(rest);
function normalizeModeId(id) {
  return id === 'outreach' ? 'reach-out' : id;
}

const rawModeId = opts._[0];
const modeId = normalizeModeId(rawModeId);

if (!rawModeId) {
  console.error(
    'Usage: build-claude-cmd.mjs <modeId> [--prompt <s> | --prompt-file <path>] [options]',
  );
  console.error('  Must be invoked via: tsx --conditions=react-server');
  console.error('  Prints the inner bash command on stdout (eval-safe).');
  process.exit(2);
}

let prompt;
if (opts['--prompt'] != null) {
  prompt = opts['--prompt'];
} else if (opts['--prompt-file']) {
  try {
    prompt = readFileSync(opts['--prompt-file'], 'utf-8');
  } catch (err) {
    console.error(
      `build-claude-cmd: failed to read --prompt-file ${opts['--prompt-file']}: ${err?.message ?? err}`,
    );
    process.exit(2);
  }
} else {
  console.error('build-claude-cmd: must pass --prompt <inline> or --prompt-file <path>');
  process.exit(2);
}

const outputFormat = opts['--output-format'] ?? 'stream-json';
if (!['stream-json', 'json', 'text'].includes(outputFormat)) {
  console.error(
    `build-claude-cmd: invalid --output-format "${outputFormat}" (allowed: stream-json | json | text)`,
  );
  process.exit(2);
}

const tools = opts['--tools']
  ? opts['--tools']
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  : undefined;

// Per-run override — the same two channels cli/resolve-mode.mjs honors:
// explicit --platform/--model args, falling back to the SUR9E_OVERRIDE_*
// env that runner.ts forwards into worker processes. CRITICAL that this
// shim resolves IDENTICALLY to resolve-mode.mjs: during the provider
// matrix the resolution shim reported "codex" while this one silently
// resolved the mode default and spawned claude — every "codex" run was
// mislabeled and zero codex tokens were spent.
const ovPlatform = opts['--platform'] || process.env.SUR9E_OVERRIDE_PLATFORM;
const ovModel = opts['--model'] || process.env.SUR9E_OVERRIDE_MODEL;
const runOverride = ovPlatform && ovModel ? { platform: ovPlatform, model: ovModel } : undefined;

let runtime;
try {
  runtime = resolveModeRuntime(process.cwd(), modeId, runOverride);
} catch (err) {
  console.error(`build-claude-cmd: resolve failed: ${err?.message ?? err}`);
  process.exit(3);
}

// System-prompt inlining for non-Claude providers. Claude takes the
// per-mode system prompt through its native --append-system-prompt-file
// flag; Codex and OpenCode have no equivalent and their adapters throw on
// it by contract ("the caller inlines the system prompt into the user
// prompt"). build-claude-cmd IS that caller, so when the resolved provider
// isn't Claude we fold the system-prompt file into the user prompt here —
// the same `system\n\n---\n\nuser` shape the screen path uses
// (batch/screen.mjs) — and clear the flag before the adapter call. This is
// what lets batch-runner.sh (which always passes the per-offer prompt via
// --append-system-prompt-file) run on any provider, not just Claude.
let appendSystemPromptFile = opts['--append-system-prompt-file'];
if (appendSystemPromptFile && runtime.provider !== 'claude') {
  let systemText;
  try {
    systemText = readFileSync(appendSystemPromptFile, 'utf-8');
  } catch (err) {
    console.error(
      `build-claude-cmd: failed to read --append-system-prompt-file ${appendSystemPromptFile}: ${err?.message ?? err}`,
    );
    process.exit(2);
  }
  prompt = `${systemText.trim()}\n\n---\n\n${prompt}`;
  appendSystemPromptFile = undefined;
}

// Provider gate lifted: all registered adapters
// (claude / codex / opencode) honor the minimal `{prompt, model}` shape and
// the optional outputFormat/tools flags. Each adapter throws from its own
// support matrix when a flag isn't applicable (e.g. opencode throws on
// `tools`), so misuse still surfaces clearly without needing a pre-check
// here. appendSystemPromptFile only ever reaches the Claude adapter now —
// the block above inlines it for every other provider.
const built = getProvider(runtime.provider).buildHeadlessArgs({
  prompt,
  model: runtime.model,
  outputFormat,
  // When --no-pipe is set, suppress the parser pipe explicitly. Otherwise
  // leave it `undefined` so the adapter's default (pipe ↔ stream-json) applies.
  pipeToParser: opts['--no-pipe'] ? false : undefined,
  tools,
  appendSystemPromptFile,
  skipPermissions: !opts['--no-skip-permissions'],
});

if (opts['--json']) {
  // JSON shape for Node callers — pass straight to child_process.spawn().
  process.stdout.write(JSON.stringify({ cmd: built.cmd, args: built.args }));
} else {
  // `built.args[1]` is the inner `bash -c` string — exactly what bash
  // callers want to splice into their own scaffold (e.g. with `eval`).
  // We deliberately print only the inner string (not the `/bin/bash -c '...'`
  // outer wrapper) so bash callers can compose it with their own
  // redirection / piping.
  process.stdout.write(built.args[1]);
}
