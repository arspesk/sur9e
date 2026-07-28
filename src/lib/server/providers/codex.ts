// src/lib/server/providers/codex.ts
//
// Codex (OpenAI) adapter — the second concrete Provider implementation.
// Wraps the `codex` CLI (`npm install -g @openai/codex`),
// which is the autonomous OpenAI coding agent. Codex is a peer of Claude
// Code in the provider layer: same Provider contract, same UnifiedStreamEvent
// downstream shape, fundamentally different argv + stream schema upstream.
//
// Key shape differences vs. claude.ts:
//
//   - Headless subcommand is `codex exec "<prompt>"` (NOT `codex run`).
//   - NDJSON flag is `--json` — there's no `--output-format` switch and no
//     equivalent of Claude's single-object `json` mode. So we treat
//     `outputFormat: 'json'` and `outputFormat: 'stream-json'` identically
//     (both emit Codex's NDJSON via `--json`). Only `outputFormat: 'text'`
//     suppresses `--json` entirely.
//   - Autonomous mode is `--dangerously-bypass-approvals-and-sandbox`
//     (single combined flag, codex 0.133.0+). The older
//     `--ask-for-approval never --sandbox danger-full-access` pair was
//     removed in newer Codex releases; this adapter targets the modern
//     CLI.
//   - Quiet/TUI suppression is via `CODEX_QUIET_MODE=1` env (set on every
//     headless spawn).
//   - No `codex models` subcommand exists. Model list comes from the cache
//     file that Codex itself maintains at `~/.codex/models_cache.json`
//     (auto-fetched by the CLI via ETag against OpenAI's internal model
//     metadata endpoint). We READ this file and filter to entries the
//     `codex /model` picker actually shows — `visibility === "list"` AND
//     `supported_in_api === true`. This is the SAME list users see when
//     they run `codex /model` interactively. If the cache file is missing
//     (fresh install, never run `codex`) or yields zero qualifying entries,
//     we fall back to FALLBACK_MODELS so the Settings picker never renders
//     empty. The cache file is owned/refreshed by Codex itself; we treat
//     it as read-only.
//
//     Why not OpenAI's `/v1/models` API? Earlier versions of this adapter
//     fetched `https://api.openai.com/v1/models` when OPENAI_API_KEY was
//     set, but that endpoint returns models that aren't valid `codex
//     --model` targets (audio, embedding, image, etc.) AND omits the
//     codex-specific slugs the CLI actually accepts (e.g. `gpt-5.3-codex`).
//     The cache file is the single source of truth for what Codex will
//     accept; `/v1/models` is the wrong list.
//   - Auth: `OPENAI_API_KEY` env is primary; `~/.codex/auth.json` from
//     `codex login` is secondary.
//
// BuildHeadlessOpts support matrix (vs. the Claude adapter, which supports
// all of them):
//
//   prompt                  — supported (single-quote shell-escaped)
//   model                   — supported (--model <id>)
//   outputFormat            — partial: 'stream-json' and 'json' both map to
//                             `--json`; 'text' omits the flag
//   skipPermissions         — supported (true → autonomous flags)
//   pipeToParser: false     — supported (default; Codex emits its own NDJSON,
//                             not Claude's, so there's nothing to pipe to
//                             cli/stream-claude-parser.mjs)
//   pipeToParser: true      — UNSUPPORTED → throws. No Codex-side parser
//                             exists yet; a future change would add
//                             cli/stream-codex-parser.mjs.
//   tools                   — UNSUPPORTED → throws. Codex tools come from
//                             MCP-server configuration, not per-call argv
//                             flags. Per-call restriction needs a different
//                             abstraction (likely MCP-server reconfiguration
//                             before spawn).
//   appendSystemPromptFile  — UNSUPPORTED → throws. Codex has no equivalent
//                             flag; the system prompt must be inlined into
//                             the user prompt body by the caller.
//
// Failing loud on the three unsupported options is intentional: silent
// degradation would produce surprising runs (a tools=[…] caller would still
// see Codex hit any MCP-registered tool, an appendSystemPromptFile caller
// would think their system prompt is being applied when it isn't). Callers
// that need any of these for a Codex-routed mode must adapt the call site
// or stay on Claude for that mode.

import 'server-only';
import { execFileSync } from 'node:child_process';
import { classifyProviderError } from '../../../../cli/classify-error.mjs';
import type { UnifiedStreamEvent } from '../../schemas/providers';
import { readTurnMcpConfig } from '../chat/mcp-config';
import { escapeForBash } from './shell';
import type { ExitClassification, Provider } from './types';

/**
 * Render a value as a TOML basic string (`"…"`) for a `codex -c key=value`
 * override. Codex parses the value portion as TOML, so backslash and
 * double-quote must be escaped; the whole `key="…"` token is then
 * single-quoted for the shell by the caller. Turn ids are UUIDs and the app
 * url is a localhost URL, so this never has to escape anything in practice —
 * it's defense-in-depth matching the shell-escaping the rest of this adapter
 * applies to model/promptFile.
 */
function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Derive a chip name + one-line detail from a codex thread-event tool item.
 * Item shapes differ per tool (command_execution carries `command`;
 * mcp_tool_call carries `server`/`tool`/`arguments`; web_search carries a
 * `query`), so every field access is defensive — an unrecognised tool still
 * yields a sensible chip rather than `undefined`.
 */
function codexToolLabel(it: any): { name: string; detail: string } {
  switch (it?.type) {
    case 'command_execution':
      return { name: 'shell', detail: String(it.command ?? '') };
    case 'mcp_tool_call': {
      const tool = it.tool ?? it.name ?? '';
      const server = it.server ?? '';
      const name = tool ? (server ? `${server}.${tool}` : String(tool)) : 'mcp';
      const args = it.arguments ?? it.args ?? it.input;
      return { name, detail: typeof args === 'string' ? args : args ? JSON.stringify(args) : '' };
    }
    case 'web_search':
      return { name: 'web_search', detail: String(it.query ?? it.q ?? '') };
    case 'file_change':
    case 'patch_apply':
      return { name: 'edit', detail: String(it.path ?? it.file ?? '') };
    default:
      return {
        name: String(it?.type ?? 'tool'),
        detail: String(it?.command ?? it?.query ?? it?.path ?? ''),
      };
  }
}

// Used when `~/.codex/models_cache.json` is unreadable / missing / yields
// zero qualifying entries (fresh install before the first `codex` run, or a
// corrupt cache). These slugs are the ones codex 0.142 actually accepts —
// verified live: each starts AND completes a `codex exec -m <id>` turn.
//
// The previous list included `gpt-5.3-codex` and `gpt-5.2`, which codex 0.142
// REJECTS ("Model metadata for `gpt-5.3-codex` not found", exit 1) — a user
// whose cache was missing got offered dead ids, and picking one failed with
// "That model isn't available". Only surface ids the installed codex runs;
// this set mirrors the current `codex /model` picker (gpt-5.5 / 5.4 / 5.4-mini).
const FALLBACK_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-mini' },
];

const codex: Provider = {
  id: 'codex',
  displayName: 'Codex',
  binary: 'codex',
  installHint: 'npm install -g @openai/codex',

  buildHeadlessArgs(opts) {
    const {
      prompt,
      model,
      outputFormat = 'json',
      pipeToParser,
      tools,
      appendSystemPromptFile,
      skipPermissions = true,
    } = opts;

    // Fail loud on the three BuildHeadlessOpts fields Codex can't honor.
    // See the support matrix at the top of this file for the rationale.
    if (pipeToParser) {
      throw new Error(
        "Codex adapter: pipeToParser is not supported (Codex emits its own NDJSON via --json, not Claude's stream-claude-parser format; no Codex parser exists yet).",
      );
    }
    if (tools && tools.length > 0) {
      throw new Error(
        'Codex adapter: tools restriction is not yet supported. Codex tools are configured via MCP servers, not per-call argv flags; per-call restriction would require a separate MCP-server reconfiguration mechanism.',
      );
    }
    if (appendSystemPromptFile) {
      throw new Error(
        'Codex adapter: appendSystemPromptFile is not supported. Codex has no equivalent flag; the system prompt must be inlined into the user prompt by the caller.',
      );
    }

    // Map outputFormat → Codex's `--json` (which emits NDJSON). Codex has no
    // single-object json format and no --output-format switch, so 'json' and
    // 'stream-json' are treated identically. Only 'text' omits the flag.
    const jsonFlag = outputFormat === 'text' ? '' : '--json ';
    // Codex 0.133.0+ combined the old `--ask-for-approval never --sandbox
    // danger-full-access` pair into one flag. The CLI hard-rejects the
    // old args with exit 2, so this needs to track the modern release.
    const permsFlags = skipPermissions ? '--dangerously-bypass-approvals-and-sandbox ' : '';
    const cmdline = `codex exec ${jsonFlag}${permsFlags}--model ${model} ${escapeForBash(prompt)}`;
    return {
      cmd: '/bin/bash',
      // Collapse any double-spaces from flag-group omission to keep argv tidy
      // and the test substring assertions stable.
      args: ['-c', cmdline.replace(/\s+/g, ' ').trim()],
      env: { CODEX_QUIET_MODE: '1' },
    };
  },

  buildInteractiveLaunch({ promptFilePath, model }) {
    // Interactive mode: same convention as the Claude adapter — hand the user
    // a paste-ready command that runs `codex` with the prompt loaded from a
    // tmp file via stdin redirect.
    return {
      cmd: '/bin/bash',
      args: ['-c', `codex --model ${model} < ${promptFilePath}`],
    };
  },

  buildChatArgs({ promptFile, model, resumeSessionId, mcpConfigPath }) {
    // TODO(chat-resume, gated by probeChatCapabilities — see
    // providers/chat-capabilities.ts): wire `codex exec resume <id>` once
    // the probe reports the subcommand. Until then the probe returns
    // resume:false for codex, the turn runner always takes the resend path,
    // and this guard is unreachable in practice — it exists so a future
    // caller bug fails loud instead of silently dropping history.
    if (resumeSessionId) {
      throw new Error(
        'Codex adapter: chat resume is not wired yet — probeChatCapabilities gates resume off for codex, so callers must not pass resumeSessionId.',
      );
    }
    // Chat needs a non-interactive run; codex has no per-call tool
    // restriction (tools come from MCP config — see the support matrix at
    // the top of this file). Read-only posture is enforced via
    // `--sandbox read-only` (filesystem-level, since codex has no per-tool
    // allowlist the way Claude does), with mutation gating as a second,
    // independent layer at the MCP confirm-card level.
    //
    // The settings below turn `codex exec` into a constrained, tools-only chat
    // assistant — the codex analogue of opencode's read-only chat config.
    // Verified against codex 0.145 with repeated live turns against the running
    // app: get_tracker resolves `✓` with data and ZERO shell commands run on
    // every turn.
    //
    //   --sandbox read-only
    //     Filesystem read-only posture (no writes, no network from
    //     model-run shell commands). Kept — NOT the autonomous
    //     `--dangerously-bypass-approvals-and-sandbox` — so a chat turn can
    //     never mutate the repo.
    //
    //   -c mcp_servers.sur9e-app.default_tools_approval_mode="approve"
    //     THE fix for the MCP cancellation. Codex gates MCP tool calls behind
    //     its OWN approval flow whenever a sandbox is active (read-only OR
    //     workspace-write) — and that gate is SEPARATE from `approval_policy`
    //     (setting `approval_policy=never` does NOT auto-approve MCP calls).
    //     In non-interactive `exec` there is no one to answer the prompt, so
    //     every sur9e-app tool call came back `× user cancelled MCP tool call`
    //     and the model fell back to guessing. Per-server
    //     `default_tools_approval_mode` (enum: auto|prompt|writes|approve)
    //     pre-approves this server's tools; `approve` = "Allow, run the tool"
    //     — the only value that lets the call run under a sandbox in exec.
    //     This is safe AND preserves the confirm-card design: codex no longer
    //     adds its own (unanswerable) approval layer, so writes actually REACH
    //     `/api/chat/actions/*`, where the in-chat confirm card is the real
    //     gate (x-sur9e-turn → confirms.ts). Reads (get_tracker/get_report/…)
    //     just return.
    //
    //   --disable shell_tool  --disable unified_exec
    //     Stops the shell exploration for good. cwd=repo-root is mandatory (for
    //     the project `.codex/config.toml` that registers the MCP server), but
    //     that cwd also puts the repo — including sur9e's own mode files and the
    //     `.agents/skills/sur9e` ROUTER skill — one `cat` away. With the shell
    //     tool enabled the model does this NON-DETERMINISTICALLY: across
    //     identical turns it sometimes goes straight to the MCP tool and
    //     sometimes shells out to `sed`/`rg` the skill + mode files first and
    //     boots as the FULL sur9e CLI agent. Disabling both exec surfaces
    //     (`shell_tool` is the classic shell; `unified_exec` is the newer exec
    //     path — both spawn `/bin/zsh -lc …`) removes the vector entirely, so
    //     the turn is MCP-tools-only. TRADE-OFF: codex reads files ONLY through
    //     the shell (it has no first-class Read tool the way claude/opencode
    //     do), so with exec disabled a codex chat turn cannot read arbitrary
    //     attached files. Report bodies are still reachable via the `get_report`
    //     MCP tool (preferred over a raw file read anyway); ad-hoc file
    //     attachments are unsupported on codex chat, which is acceptable while
    //     codex chat is experimental.
    //
    //   --disable skill_search
    //     Belt-and-suspenders on the skill hijack: keeps codex from surfacing
    //     the repo's `sur9e` router skill into context at all. (Exec is already
    //     gone above, so the skill couldn't be acted on regardless, but not
    //     surfacing it keeps the turn focused on the chat persona.)
    //     `-c project_doc_max_bytes=0` handles the parallel AGENTS.md hijack;
    //     project_doc_max_bytes only bounds the project doc, NOT config.toml,
    //     so the MCP wiring below is unaffected.
    const parts = [
      'codex exec',
      '--json',
      '--sandbox read-only',
      '-c project_doc_max_bytes=0',
      `-c ${escapeForBash(`mcp_servers.sur9e-app.default_tools_approval_mode=${tomlBasicString('approve')}`)}`,
      '--disable shell_tool',
      '--disable unified_exec',
      '--disable skill_search',
    ];

    // Turn-scoped MCP wiring — the codex analogue of claude's `--mcp-config
    // --strict-mcp-config`. codex has no "point at this MCP config file" flag,
    // but `-c dotted.path=value` overrides a config leaf (value parsed as TOML)
    // on top of the config loaded from `.codex/config.toml`. When codex runs
    // with cwd=repo-root (every chat turn does), it loads the project
    // `.codex/config.toml`, which already registers the `sur9e-app` server
    // (command + args + SUR9E_APP_URL). We inject this turn's id (and app url)
    // INTO that server's `env` table — verified against codex 0.142 that a
    // dotted `mcp_servers.sur9e-app.env.<KEY>` override deep-merges into the
    // existing env rather than replacing it, so both SUR9E_APP_URL and
    // SUR9E_CHAT_TURN_ID reach the spawned mcp-app-server. That turn id is what
    // makes the action routes emit a confirm card (see cli/mcp-app-server.mjs
    // appFetch → x-sur9e-turn header → confirms.ts) instead of falling back to
    // terminal-mode model-adjudicated approval with no card.
    //
    // No separate "strict" flag is needed (unlike claude): there is a single
    // sur9e-app registration — the project one — and we amend it in place, so
    // there is no second turn-id-less server that could win a merge race.
    if (mcpConfigPath) {
      const turn = readTurnMcpConfig(mcpConfigPath);
      if (turn) {
        for (const key of ['SUR9E_CHAT_TURN_ID', 'SUR9E_APP_URL'] as const) {
          const value = turn.env[key];
          if (value) {
            parts.push(
              `-c ${escapeForBash(`mcp_servers.sur9e-app.env.${key}=${tomlBasicString(value)}`)}`,
            );
          }
        }
      }
    }

    parts.push(`--model ${escapeForBash(model)}`);
    const cmdline = `${parts.join(' ')} "$(cat ${escapeForBash(promptFile)})"`;
    return { cmd: '/bin/bash', args: ['-c', cmdline], env: { CODEX_QUIET_MODE: '1' } };
  },

  extractSessionId(_streamLine) {
    // thread.started carries a thread_id, but until `codex exec resume` is
    // wired (see buildChatArgs TODO) a stored id would only rot — return
    // null so no codex session handle is ever persisted.
    return null;
  },

  detectResumeFailure(_stdout, _stderr) {
    return false; // no resume attempts yet → nothing to detect
  },

  parseStreamLine(line) {
    if (!line.trim()) return null;
    // Codex's `exec --json` schema is external and untyped; we shrug at unknown
    // shapes (return null) rather than crash so a CLI upgrade that adds a
    // new event type degrades gracefully — same convention as claude.ts.
    //
    // The real 0.142 stream (verified live) is a THREAD-EVENT envelope:
    //   thread.started / turn.started            — infra, no output
    //   item.started  { item: { id, type, … } }  — a work item OPENED
    //   item.completed{ item: { id, type, … } }  — a work item CLOSED
    //   turn.completed{ usage }                  — terminal usage
    // Item types seen: `reasoning` (field `text`), `agent_message` (`text`),
    // `command_execution` (`command`, `exit_code`, `status`), `mcp_tool_call`,
    // `web_search`, `file_change`, and `error` (plugin/skill notices — noise).
    // The earlier parser matched `reasoning`/`tool_use`/`message` with
    // fields `summary`/`name`/`input`/`content` — NONE of which this codex
    // emits, so codex chats never produced a single thinking or tool chip.
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }
    const ts = new Date().toISOString();

    // Infra handshakes — never model output (dropped so no "thread … started"
    // line leaks into the transcript).
    if (obj.type === 'thread.started' || obj.type === 'turn.started') return null;

    if ((obj.type === 'item.started' || obj.type === 'item.completed') && obj.item) {
      const it = obj.item;
      const started = obj.type === 'item.started';
      const id = typeof it.id === 'string' ? it.id : undefined;

      switch (it.type) {
        case 'reasoning':
          // Reasoning only ever arrives as item.completed (no paired start).
          return started ? null : { kind: 'thinking', message: String(it.text ?? ''), ts };
        case 'agent_message':
          // Reply text — surfaced as a stage for the unified stream; the chat
          // layer extracts the full-fidelity text separately and suppresses
          // this duplicate (see mapChatLine).
          return started
            ? null
            : { kind: 'stage', message: String(it.text ?? '').slice(0, 200), ts };
        case 'error':
          // Plugin-hook / skill-budget notices codex prints as error items —
          // infra noise, not a turn failure (that surfaces via a non-zero
          // exit + stderr). Never render.
          return null;
        default:
          break;
      }

      // Everything else with an item.started/completed pair is a TOOL:
      // command_execution, mcp_tool_call, web_search, file_change, patch_apply,
      // custom_tool_call, … Derive a stable name + one-line detail defensively
      // (item shapes vary by tool) and lean on the started/completed envelope
      // for the lifecycle so the chip opens on start and resolves on close.
      const { name, detail } = codexToolLabel(it);
      const message = detail ? `${name}: ${detail.slice(0, 120)}` : name;
      if (started) return { kind: 'tool', toolStatus: 'start', toolId: id, message, ts };
      const failed =
        (typeof it.exit_code === 'number' && it.exit_code !== 0) ||
        it.status === 'failed' ||
        it.status === 'error' ||
        it.is_error === true;
      return { kind: 'tool', toolStatus: failed ? 'error' : 'done', toolId: id, message, ts };
    }

    if (obj.type === 'turn.completed') {
      // Codex's `turn.completed` is the terminal event of a run, carrying
      // usage. Mapped to 'tokens' for symmetry with claude.ts's `result`
      // handling — downstream consumers treat receipt of `tokens` as
      // end-of-stream. Note: codex's usage block carries no model id, so we
      // leave `model` empty and let the caller fall back to the selected model.
      const u = obj.usage ?? {};
      const tokens: UnifiedStreamEvent['tokens'] = {
        in: Number(u.input_tokens ?? 0),
        out: Number(u.output_tokens ?? 0),
        model: typeof obj.model === 'string' ? obj.model : '',
        estimated: false,
      };
      return {
        kind: 'tokens',
        message: `turn.completed: ${tokens.in} in / ${tokens.out} out`,
        tokens,
        ts,
      };
    }
    return null;
  },

  async listModels() {
    // Source of truth: `~/.codex/models_cache.json`. Codex maintains this
    // file itself (auto-refreshes via ETag on each run) and uses it to power
    // its own `/model` interactive picker. Filtering to `visibility: "list"`
    // + `supported_in_api: true` gives us the EXACT same list the picker
    // displays — no guessing, no API mismatches.
    //
    // The file is owned by Codex; we treat it as read-only. If it's missing
    // (fresh install before first `codex` invocation), malformed, or yields
    // zero qualifying entries, we fall back to FALLBACK_MODELS rather than
    // return an empty list (which would break the Settings dropdown).
    try {
      const { existsSync, readFileSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const cachePath = join(homedir(), '.codex/models_cache.json');
      if (existsSync(cachePath)) {
        const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
        const models: any[] = Array.isArray(cache?.models) ? cache.models : [];
        const filtered = models
          .filter(
            m =>
              m?.visibility === 'list' &&
              m?.supported_in_api === true &&
              typeof m?.slug === 'string' &&
              m.slug.length > 0,
          )
          .map(m => ({
            id: String(m.slug),
            label:
              typeof m.display_name === 'string' && m.display_name.length > 0
                ? String(m.display_name)
                : String(m.slug),
          }));
        if (filtered.length > 0) return filtered;
        // Zero qualifying entries → fall through to FALLBACK_MODELS rather
        // than render an empty picker.
      }
    } catch {
      // Read / JSON-parse failure → fall through. Intentionally swallowed:
      // the picker must not crash the Settings page just because the cache
      // file is corrupt or unreadable.
    }
    return FALLBACK_MODELS;
  },

  async checkInstalled() {
    try {
      const out = execFileSync('codex', ['--version'], { encoding: 'utf-8', timeout: 3000 });
      const m = out.match(/(\d+\.\d+\.\d+)/);
      return { ok: true, version: m?.[1] };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  async checkAuth() {
    // Primary: OPENAI_API_KEY in the process env. Secondary: ~/.codex/auth.json
    // populated by `codex login`. Either path counts as "auth ok".
    if (process.env.OPENAI_API_KEY) return { ok: true };
    try {
      const { existsSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      if (existsSync(join(homedir(), '.codex/auth.json'))) return { ok: true };
    } catch {
      /* ignore — fall through to the not-detected warning */
    }
    return { ok: false, warning: 'Set OPENAI_API_KEY or run `codex login`.' };
  },

  classifyExitError(stderr, _code) {
    return classifyProviderError('codex', stderr) as ExitClassification;
  },
};

export default codex;
