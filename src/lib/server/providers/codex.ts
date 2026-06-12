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
import { escapeForBash } from './shell';
import type { ExitClassification, Provider } from './types';

// Used when `~/.codex/models_cache.json` is unreadable / missing / yields
// zero qualifying entries (fresh install before the first `codex` run, or a
// corrupt cache). These slugs match the picker output captured against
// codex 0.133.0 in 2026-05; the actual cache file always wins when present.
// Intentionally NOT the long legacy gpt-4o / o1 / o3 list — those families
// aren't surfaced by the modern `codex /model` picker and would mislead
// users into picking ids the CLI then rejects.
const FALLBACK_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-mini' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3-codex' },
  { id: 'gpt-5.2', label: 'GPT-5.2' },
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

  parseStreamLine(line) {
    if (!line.trim()) return null;
    // Codex's `--json` schema is external and untyped; we shrug at unknown
    // shapes (return null) rather than crash so a CLI upgrade that adds a
    // new event type degrades gracefully — same convention as claude.ts.
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }
    const ts = new Date().toISOString();
    if (obj.type === 'thread.started') {
      return { kind: 'stage', message: `thread ${obj.thread_id ?? '?'} started`, ts };
    }
    if (obj.type === 'item.completed' && obj.item) {
      const it = obj.item;
      if (it.type === 'reasoning') {
        return { kind: 'thinking', message: String(it.summary ?? '').slice(0, 200), ts };
      }
      if (it.type === 'tool_use') {
        const summary = it.input?.command || it.input?.url || it.input?.path || '';
        return {
          kind: 'tool',
          message: `${it.name}${summary ? `: ${String(summary).slice(0, 120)}` : ''}`,
          ts,
        };
      }
      if (it.type === 'message') {
        return { kind: 'stage', message: String(it.content ?? '').slice(0, 200), ts };
      }
    }
    if (obj.type === 'turn.completed') {
      // Codex's `turn.completed` is the terminal event of a run, carrying
      // usage. Mapped to 'tokens' for symmetry with claude.ts's `result`
      // handling — downstream consumers treat receipt of `tokens` as
      // end-of-stream.
      const u = obj.usage ?? {};
      const tokens: UnifiedStreamEvent['tokens'] = {
        in: Number(u.input_tokens ?? 0),
        out: Number(u.output_tokens ?? 0),
        model: obj.model ?? 'unknown',
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
