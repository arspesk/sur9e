// src/lib/server/providers/opencode.ts
//
// OpenCode (sst) adapter — the third concrete Provider implementation.
// Wraps the `opencode` CLI from sst (Go binary,
// `npm i -g opencode-ai` or `brew install anomalyco/tap/opencode`).
//
// Key shape differences vs. claude.ts and codex.ts:
//
//   - Headless subcommand is `opencode run "<prompt>"` (positional prompt).
//   - **No --json flag on `run`**: emits plain text on stdout, full stop.
//     Structured event streams exist only via OpenCode's HTTP server mode,
//     which is out of scope for the spawn-and-tail adapter contract. All
//     `BuildHeadlessOpts` fields that imply a structured stream
//     (outputFormat !== 'text', pipeToParser: true) therefore throw rather
//     than silently degrade — a caller who set `outputFormat: 'json'` and
//     got plain text instead would silently break downstream JSON.parse.
//   - **No token telemetry on stdout**: we estimate via tiktoken (js-tiktoken,
//     Wasm-free port) on `{promptText, accumulatedStdoutText, model}` at job
// (token estimation lives in batch/lib/usage.mjs — uniform tiktoken path)
//     runner; the returned `tokens` object carries `estimated: true`
//     so the analytics dashboard can badge these rows as approximate.
//   - **No per-call tool restriction**: OpenCode tool allow-lists are set in
//     the OpenCode config file, not on the command line. We throw on `tools`
//     for the same loud-failure reason as the structured-stream options.
//   - **No `--append-system-prompt-file` equivalent**: throw on it; system
//     prompt must be inlined into the user prompt by the caller.
//   - **Autonomous-only**: `opencode run` has no documented permission-prompt
//     flag. `skipPermissions: false` throws (we don't pretend we can opt in
//     to an approval flow that doesn't exist on this CLI).
//   - Model id is `provider/model_id` (e.g. `anthropic/claude-3-haiku`,
//     `openrouter/moonshotai/kimi-k2.6`) — passed via `-m` (short for
//     `--model`).
//   - Auth: either a provider env var (ANTHROPIC_API_KEY / OPENAI_API_KEY /
//     OPENROUTER_API_KEY) OR a credential persisted by `opencode auth login`
//     to ~/.local/share/opencode/auth.json. checkAuth probes both — env vars
//     win first; the auth.json fallback covers OAuth-logged-in users who have
//     no env vars set.
//
// STATIC_FALLBACK rationale: `opencode models` is the live source of truth,
// but in dev environments (CI runners, fresh installs, container builds) the
// binary may be missing or older than the version that ships the subcommand.
// Rather than block the model picker on a CLI probe, we ship a tiny curated
// list of provider/model ids that we know work today. Users can type custom
// model ids in the picker if they need something off-list.

import 'server-only';
import { execFileSync } from 'node:child_process';
import { getEncoding } from 'js-tiktoken';
import { classifyProviderError } from '../../../../cli/classify-error.mjs';
import { escapeForBash } from './shell';
import type { ExitClassification, Provider } from './types';

// Used when `opencode models` command isn't reachable (binary not installed,
// CLI version doesn't ship the subcommand, timeout, etc.). Curated list of
// provider/model ids most useful for sur9e users — intentionally small. The
// picker UI lets users type custom ids if they need something off-list.
const STATIC_FALLBACK = [
  { id: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku via Anthropic' },
  { id: 'anthropic/claude-3-sonnet', label: 'Claude 3 Sonnet via Anthropic' },
  { id: 'openrouter/moonshotai/kimi-k2.6', label: 'Kimi K2.6 via OpenRouter' },
];

/**
 * Estimate input/output tokens for an OpenCode run using tiktoken's
 * `cl100k_base` encoding. Used by the runner at job close, with
 * the full prompt text and accumulated stdout text.
 *
 * Why cl100k_base across providers: it's a sensible cross-provider proxy that
 * gets us within ~20% of the real token count for an order-of-magnitude USD
 * estimate. Anthropic, OpenAI, and OpenRouter all use BPE variants with
 * similar character/token ratios. The `estimated: true` flag warns the
 * analytics dashboard to badge these rows so users don't conflate them with
 * exact counts from Claude / Codex adapters.
 *
 * Why js-tiktoken (not tiktoken): js-tiktoken is the pure-JS port — no Wasm,
 * no native bindings, safe in any Next.js server runtime. The `tiktoken` npm
 * package is the Wasm port and is heavier + needs platform-specific binaries.
 */

const opencode: Provider = {
  id: 'opencode',
  displayName: 'OpenCode',
  binary: 'opencode',
  installHint: 'npm i -g opencode-ai  OR  brew install anomalyco/tap/opencode',

  buildHeadlessArgs(opts) {
    const {
      prompt,
      model,
      outputFormat = 'text',
      pipeToParser,
      tools,
      appendSystemPromptFile,
      skipPermissions = true,
    } = opts;

    // OpenCode's `opencode run` emits plain text only. None of the
    // structured-output options apply. Fail loud rather than silently
    // produce a bad invocation — a caller who passed `outputFormat: 'json'`
    // would otherwise get plain text on stdout and break their JSON.parse.
    if (outputFormat !== 'text') {
      throw new Error(
        `OpenCode adapter: outputFormat "${outputFormat}" not supported — \`opencode run\` only emits plain text. Token telemetry is estimated via tiktoken at job close.`,
      );
    }
    if (pipeToParser) {
      throw new Error(
        'OpenCode adapter: pipeToParser is not supported — no structured event stream exists for `opencode run`.',
      );
    }
    if (tools && tools.length > 0) {
      throw new Error(
        'OpenCode adapter: tools restriction is not supported — OpenCode tool selection is configured per-provider in the OpenCode config file, not per-call.',
      );
    }
    if (appendSystemPromptFile) {
      throw new Error(
        'OpenCode adapter: appendSystemPromptFile is not supported — no equivalent CLI flag exists. System prompt must be inlined in the user prompt.',
      );
    }
    if (!skipPermissions) {
      throw new Error(
        'OpenCode adapter: skipPermissions: false is not supported — `opencode run` is autonomous-only at this version.',
      );
    }
    // --pure: run without external plugins. User-installed plugins (e.g. the
    // Warp cli-agent notifier) hijack the output streams — machine events on
    // stdout, the model transcript ANSI-rendered on stderr — which broke
    // sentinel parsing in the provider matrix. Headless runs need the plain
    // response on stdout.
    const cmdline = `opencode run --pure -m ${model} ${escapeForBash(prompt)}`;
    return { cmd: '/bin/bash', args: ['-c', cmdline] };
  },

  buildInteractiveLaunch({ promptFilePath, model }) {
    // OpenCode's headless `opencode run` doubles as the interactive entry
    // point — feed the prompt body from the tmp file via command substitution
    // since `opencode run` takes the prompt as a positional argument (no
    // stdin redirect mode at this CLI version).
    return {
      cmd: '/bin/bash',
      args: ['-c', `opencode run -m ${model} "$(cat ${promptFilePath})"`],
    };
  },

  parseStreamLine(line) {
    if (!line.trim()) return null;
    const ts = new Date().toISOString();
    // Lightweight heuristic: OpenCode's plain-text stdout uses "Tool call:"
    // and "Tool result:" prefixes for tool-related lines. Everything else
    // is a stage update (model load, run lifecycle, free-form messages,
    // file writes). Truncate to 200 chars to match the cap used by
    // claude.ts/codex.ts so UI rendering stays bounded.
    const lower = line.toLowerCase();
    if (lower.startsWith('tool call:') || lower.startsWith('tool result:')) {
      return { kind: 'tool', message: line.slice(0, 200), ts };
    }
    return { kind: 'stage', message: line.slice(0, 200), ts };
  },

  async listModels() {
    // Try the live `opencode models` subcommand first; fall back to the
    // curated static list when it's unavailable (binary missing, CLI
    // version doesn't ship the subcommand, timeout, etc.). The timeout
    // is intentionally short — model-picker UI must not block.
    try {
      const out = execFileSync('opencode', ['models'], { encoding: 'utf-8', timeout: 5000 });
      const ids = out
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      if (ids.length === 0) return STATIC_FALLBACK;
      return ids.map(id => ({ id, label: id }));
    } catch {
      return STATIC_FALLBACK;
    }
  },

  async checkInstalled() {
    try {
      const out = execFileSync('opencode', ['--version'], { encoding: 'utf-8', timeout: 3000 });
      const m = out.match(/(\d+\.\d+\.\d+)/);
      return { ok: true, version: m?.[1] };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  async checkAuth() {
    // OpenCode stores credentials in `~/.local/share/opencode/auth.json` after
    // `opencode auth login`. Probing for that file is the most reliable signal
    // — env vars + the persisted credential store are both valid auth shapes,
    // but a user who only ran `opencode auth login` would have no env vars at
    // all. Original implementation missed this and falsely warned "not authed"
    // for OAuth-logged-in users.
    const envOk = !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENROUTER_API_KEY
    );
    if (envOk) return { ok: true };
    try {
      const { existsSync, statSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const authPath = join(homedir(), '.local/share/opencode/auth.json');
      if (existsSync(authPath) && statSync(authPath).size > 2) {
        return { ok: true };
      }
    } catch {
      /* fall through */
    }
    return {
      ok: false,
      warning:
        'Set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY env var, or run `opencode auth login`.',
    };
  },

  classifyExitError(stderr, _code) {
    return classifyProviderError('opencode', stderr) as ExitClassification;
  },
};

export default opencode;
