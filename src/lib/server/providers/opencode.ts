// src/lib/server/providers/opencode.ts
//
// OpenCode (sst) adapter — the third concrete Provider implementation.
// Wraps the `opencode` CLI from sst (Go binary,
// `npm i -g opencode-ai` or `brew install anomalyco/tap/opencode`).
//
// Key shape differences vs. claude.ts and codex.ts:
//
//   - Headless subcommand is `opencode run "<prompt>"` (positional prompt).
//   - **Headless `run` stays plain-text**: `buildHeadlessArgs` deliberately
//     emits the report on plain stdout while forwarding ERROR-level OpenCode
//     logs to stderr so the fallback classifier can see provider failures
//     (token telemetry is estimated via tiktoken at job
//     close), so every `BuildHeadlessOpts` field that implies a structured
//     stream (outputFormat !== 'text', pipeToParser: true) throws rather than
//     silently degrade. The interactive CHAT path is different: `buildChatArgs`
//     passes `opencode run --format json --thinking` (opencode ≥ 1.x), which
//     streams structured NDJSON parts (step_start / reasoning / tool_use /
//     text / step_finish) — that's what powers the chat transcript's thinking
//     blocks + tool chips. See `parseStreamLine`, which parses those parts.
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
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEncoding } from 'js-tiktoken';
import { classifyProviderError } from '../../../../cli/classify-error.mjs';
import type { UnifiedStreamEvent } from '../../schemas/providers';
import { PLAYWRIGHT_CHAT_TOOLS, readTurnMcpConfig, readTurnMcpServers } from '../chat/mcp-config';
import { escapeForBash } from './shell';
import type { ExitClassification, Provider } from './types';

// Read-only chat config (buildChatArgs only) — see the long comment there.
// A minimal opencode config object expressing "no filesystem/shell mutation,
// no subagent spawn, reads + web tools OK". Written fresh per chat turn to
// os.tmpdir() and pointed at via OPENCODE_CONFIG so the project's own
// opencode.json (which carries the "mcp" playwright server block) is never
// read from disk and rewritten, only ever merged with.
function buildReadOnlyChatConfig(): Record<string, unknown> {
  return {
    $schema: 'https://opencode.ai/config.json',
    permission: {
      // "edit" gates the edit, write, AND apply_patch tools together —
      // confirmed via opencode's own docs (docs/tools: "The write tool is
      // controlled by the edit permission, which covers all file
      // modifications (edit, write, apply_patch)"). One key, three tools.
      edit: 'deny',
      bash: 'deny',
      // Subagents (the "task" tool) can carry their own permission
      // overrides, so a subagent spawned mid-chat could reintroduce
      // write/bash access. Denied for the same reason claude.ts's
      // CHAT_DISALLOWED_TOOLS includes "Task".
      task: 'deny',
      read: 'allow',
      grep: 'allow',
      glob: 'allow',
      webfetch: 'allow',
      websearch: 'allow',
      'playwright_*': 'deny',
      ...Object.fromEntries(PLAYWRIGHT_CHAT_TOOLS.map(tool => [`playwright_${tool}`, 'allow'])),
    },
  };
}

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
    // response on stdout. --print-logs with ERROR-only verbosity exposes
    // provider quota, rate-limit, auth, and model failures on stderr; without
    // it OpenCode can log the terminal error privately and remain alive until
    // sur9e's outer timeout instead of triggering the configured fallback.
    const cmdline = `opencode run --pure --print-logs --log-level ERROR -m ${model} ${escapeForBash(prompt)}`;
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

  buildChatArgs({ promptFile, model, resumeSessionId, mcpConfigPath }) {
    // TODO(chat-resume, gated by probeChatCapabilities — see
    // providers/chat-capabilities.ts): wire the session flag once the probe
    // reports it. Until then the probe returns resume:false for opencode
    // and the turn runner always takes the resend path.
    if (resumeSessionId) {
      throw new Error(
        'OpenCode adapter: chat resume is not wired yet — probeChatCapabilities gates resume off for opencode, so callers must not pass resumeSessionId.',
      );
    }
    // Chat needs a non-interactive, read-only run (spec §3.7 — chat never
    // gets Bash/Write/Edit; mutations go through confirm-gated MCP actions
    // only). `opencode run` has NO per-invocation CLI flag for this: `--pure`
    // only disables external plugins, not tool access, and (unlike claude's
    // --allowedTools/--disallowedTools or codex's --sandbox read-only)
    // opencode has no `--tools`/`--permission` flag on `run` at all — the
    // module doc comment above ("No per-call tool restriction") already
    // established this for buildHeadlessArgs, and it's equally true here.
    //
    // The only place opencode exposes tool restriction is its CONFIG file
    // (opencode.json), via a `permission` block — confirmed against the
    // live https://opencode.ai/config.json schema and opencode's own docs
    // (docs/permissions, docs/tools, docs/config) on 2026-07-19. `"deny"`
    // (not `"ask"`) is required: `"ask"` prompts for interactive approval,
    // which would hang `opencode run` — there's no TTY in this spawn to
    // answer it — while `"deny"` blocks the tool call outright per
    // docs/permissions ("deny to block the action entirely").
    //
    // Per-invocation config path: the OPENCODE_CONFIG env var (confirmed at
    // https://opencode.ai/docs/config — "Set the OPENCODE_CONFIG environment
    // variable to specify a custom path for the OpenCode configuration
    // file"). We write a throwaway config to os.tmpdir() per turn and point
    // OPENCODE_CONFIG at it, rather than writing/clobbering this repo's own
    // opencode.json (which carries the "mcp" playwright server block and
    // must not be touched by a chat turn). Docs/config also states
    // OPENCODE_CONFIG "is loaded in the precedence order between global and
    // project configurations" — i.e. it's deep-merged in, and the project's
    // own opencode.json has the HIGHEST precedence of the three. This
    // repo's opencode.json currently defines no `permission` key, so there
    // is nothing to conflict with today; if that ever changes, a
    // project-level `permission.edit`/`permission.bash` override could win
    // over this temp config and silently widen chat back past read-only —
    // worth a lint/doctor check if opencode.json ever grows a permission
    // block.
    //
    // RESIDUAL (needs a live turn): the config MERGE + OPENCODE_CONFIG loading
    // are verified via `opencode debug config` (opencode 1.17), but whether a
    // denied edit/bash/task call fails the tool cleanly (vs. hanging the run)
    // has not been exercised against a live turn.
    const config = buildReadOnlyChatConfig();

    // Turn-scoped MCP wiring — the opencode analogue of claude's `--mcp-config
    // --strict-mcp-config`. opencode's per-invocation config mechanism is the
    // OPENCODE_CONFIG env var (same file we're already writing for the
    // read-only permission block), and its config schema carries an `mcp`
    // block. We register the `sur9e-app` server here WITH this turn's id in its
    // `environment`, lifted straight out of the claude-format config the turn
    // runner already wrote (readTurnMcpConfig). That turn id is what makes the
    // action routes emit a confirm card (cli/mcp-app-server.mjs appFetch →
    // x-sur9e-turn header → confirms.ts) instead of falling back to
    // terminal-mode approval with no card.
    //
    // The project's own opencode.json ALSO registers `sur9e-app` (without a
    // turn id) and has the highest merge precedence, but verified against
    // opencode 1.17 that same-named `mcp` servers deep-merge their
    // `environment` sub-objects across config layers — so this turn's
    // SUR9E_CHAT_TURN_ID (present only in OPENCODE_CONFIG) survives the merge
    // rather than being wiped by the project block. opencode also
    // schema-validates each config file's `mcp.<name>` block independently, so
    // the block must be COMPLETE (type/command/enabled) — a partial override
    // is rejected; hence we re-state command/enabled, not just environment.
    if (mcpConfigPath) {
      const turn = readTurnMcpConfig(mcpConfigPath);
      if (turn) {
        const servers = readTurnMcpServers(mcpConfigPath);
        const playwright = servers.playwright;
        config.mcp = {
          ...(playwright
            ? {
                playwright: {
                  type: 'local',
                  command: [playwright.command, ...playwright.args],
                  enabled: true,
                },
              }
            : {}),
          'sur9e-app': {
            type: 'local',
            command: [turn.command, ...turn.args],
            enabled: true,
            environment: turn.env,
          },
        };
      }
    }

    const configPath = join(tmpdir(), `sur9e-chat-readonly-${randomUUID()}.json`);
    writeFileSync(configPath, JSON.stringify(config), 'utf-8');
    // `--format json` (opencode ≥ 1.x) streams structured NDJSON parts
    // (step_start / reasoning / tool_use / text / step_finish) instead of the
    // formatted TUI text `run` prints by default. That's what lets the chat
    // transcript render thinking blocks + tool chips for opencode turns (the
    // plain-text output carried no reliable tool/reasoning markers). `--thinking`
    // opts the reasoning parts into the stream. See parseStreamLine below.
    const cmdline = `opencode run --pure --format json --thinking -m ${escapeForBash(model)} "$(cat ${escapeForBash(promptFile)})"`;
    return {
      cmd: '/bin/bash',
      args: ['-c', cmdline],
      env: { OPENCODE_CONFIG: configPath },
    };
  },

  extractSessionId(_streamLine) {
    return null; // plain-text stdout carries no session id
  },

  detectResumeFailure(_stdout, _stderr) {
    return false; // no resume attempts yet → nothing to detect
  },

  parseStreamLine(line) {
    if (!line.trim()) return null;
    // Chat turns run `opencode run --format json` (see buildChatArgs), which
    // emits one JSON object per streamed message part (verified live against
    // opencode 1.17):
    //   { type: 'reasoning',  part: { text } }                    — thinking
    //   { type: 'text',       part: { text } }                    — reply text
    //   { type: 'tool_use',   part: { tool, callID, state: {…} } } — a tool call
    //   { type: 'step_start' | 'step_finish', part: { tokens } }  — lifecycle
    // A tool part's `state.status` ('pending'|'running'|'completed'|'error')
    // gives the lifecycle; `callID` pairs the open/close. `opencode run`
    // (non-interactive) emits each part once at completion, so a tool commonly
    // arrives already 'completed' — foldEvents materialises a resolved chip
    // when a close event has no matching open call.
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      // Non-JSON (stray log lines with --print-logs, etc.) — ignore.
      return null;
    }
    const ts = new Date().toISOString();
    const part = obj?.part ?? {};
    switch (obj?.type) {
      case 'reasoning':
        return { kind: 'thinking', message: String(part.text ?? ''), ts };
      case 'text':
        // Reply text — the chat layer extracts full-fidelity text separately
        // and suppresses this duplicate stage (see mapChatLine).
        return { kind: 'stage', message: String(part.text ?? '').slice(0, 200), ts };
      case 'tool_use': {
        const name = String(part.tool ?? 'tool');
        const id = typeof part.callID === 'string' ? part.callID : undefined;
        const input = part.state?.input ?? {};
        const detail = String(
          input.command ?? input.filePath ?? input.description ?? input.pattern ?? '',
        );
        const message = detail ? `${name}: ${detail.slice(0, 120)}` : name;
        const status = part.state?.status;
        const toolStatus = status === 'completed' ? 'done' : status === 'error' ? 'error' : 'start';
        return { kind: 'tool', toolStatus, toolId: id, message, ts };
      }
      case 'step_finish': {
        const tk = part.tokens ?? {};
        const tokens: UnifiedStreamEvent['tokens'] = {
          in: Number(tk.input ?? 0),
          out: Number(tk.output ?? 0),
          model: '',
          estimated: false,
        };
        return {
          kind: 'tokens',
          message: `step_finish: ${tokens.in} in / ${tokens.out} out`,
          tokens,
          ts,
        };
      }
      default:
        return null;
    }
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
