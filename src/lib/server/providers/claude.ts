// src/lib/server/providers/claude.ts
//
// Claude Code adapter — the first concrete Provider implementation.
//
// Wraps the `claude` CLI binary (Claude Code, https://docs.claude.com/code)
// which is already a hard dependency of sur9e. Today's evaluation jobs in
// `src/lib/server/jobs/command-registry.ts` spawn this binary inline; once
// those call sites are swapped for a dispatcher hop, this adapter is
// what the dispatcher will hand to the spawner.
//
// Why command-shape parity matters: the dispatcher swap promises "no behavior
// change" when call sites flip over. `buildHeadlessArgs` therefore reproduces the
// exact argv that command-registry.ts hardcodes today — same flag order,
// same `--output-format stream-json --verbose`, same pipe into
// `cli/stream-claude-parser.mjs`, all wrapped in `/bin/bash -c`. The one
// intentional improvement is prompt quoting: the legacy command uses
// double-quotes (vulnerable to `$`, backticks, and `\\` inside the prompt),
// the adapter uses single-quotes with the standard `'"'"'` escape so any
// JD text is shell-safe.
//
// Where the model list comes from: the `claude` CLI
// has no `list-models` subcommand and no `/v1/models` endpoint Claude Code
// itself calls — the `/model` interactive picker is powered by string ids
// compiled into the ~200MB Rust binary. We extract them at startup by
// shelling out to `strings` on the resolved binary, grep-filtering for the
// `claude-(opus|sonnet|haiku)-…` pattern, then caching the cleaned list
// keyed on `claude --version` (so a user-side `claude` upgrade
// auto-refreshes on the next adapter call). `strings` on a ~200MB binary
// runs in ~0.3s on a modern Mac, so the cold call is acceptable and warm
// calls hit the in-process cache.
//
// Fallback: if `which claude` can't be resolved, the platform-specific
// sub-package isn't where we expect, or `strings` isn't available (e.g.
// Windows hosts running the dev server), we degrade to STATIC_MODELS — a
// tight curated set that the current `claude` versions all accept.
//
// Why no Anthropic `/v1/models` fetch: sur9e users almost always
// authenticate via Claude Max OAuth, not an `ANTHROPIC_API_KEY`. The API
// call would 401 on the typical user, so the live-fetch path would always
// fall back to the static list anyway — net cost without net benefit.

import 'server-only';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { classifyProviderError } from '../../../../cli/classify-error.mjs';
import type { UnifiedStreamEvent } from '../../schemas/providers';
import { PLAYWRIGHT_CHAT_TOOLS } from '../chat/mcp-config';
import { providerCliEnv, withProviderCliPath } from './cli-path';
import { escapeForBash } from './shell';
import type { ExitClassification, ModelChoice, Provider } from './types';

// Tight fallback set used only when binary-strings extraction fails (e.g.
// `which claude` returns nothing, the platform-arch sub-package isn't laid
// out the way we expect, `strings` is unavailable on the host). Intentionally
// short — these three dated ids are the ones the recent Claude versions all
// accept, so a fallback render still gives the user something usable instead
// of an empty picker.
const STATIC_MODELS: ModelChoice[] = [
  { id: 'claude-opus-4-7', label: 'claude-opus-4-7' },
  { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
  { id: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5 (2025-10-01)' },
];

// Module-level cache keyed on `claude --version` output. Reset on adapter
// reload (dev-server restart). We deliberately do NOT include the binary's
// mtime: if Anthropic ships a same-version-different-binary build the
// worst case is one dev-server restart to refresh, not a production issue.
let claudeModelsCache: { version: string; models: ModelChoice[] } | null = null;

// Size floor (bytes) above which a resolved path is treated as the real
// CLI executable rather than a shim. The shipped binary is ~200MB+; a JS
// wrapper (`cli-wrapper.cjs`) is a few KB. 10MB sits comfortably between
// the two regardless of future binary growth or wrapper size.
const CLAUDE_BINARY_MIN_BYTES = 10 * 1024 * 1024;

// fs probes for `_pickClaudeBinaryFromReal`, injected so the pure layout
// logic is unit-testable without mocking `node:fs` (Vitest's node-builtin
// mocking is flaky in this project — see the test header).
type BinaryProbes = {
  // Is `p` itself the strings-able executable (a large Mach-O/ELF, not a shim)?
  isExecutable: (p: string) => boolean;
  dirExists: (p: string) => boolean;
  readdir: (p: string) => string[];
  fileExists: (p: string) => boolean;
};

// Pure core: given the realpath'd target of `which claude` plus fs probes,
// return the path to a `strings`-able executable (or null). Two install
// layouts in the wild, and we must handle BOTH:
//
//   1. Native installer (`curl … | bash`, or Claude Code's self-update):
//      `~/.local/bin/claude` → `~/.local/share/claude/versions/<version>`.
//      The symlink target IS the ~200MB executable itself, named by version
//      number. npm's `bin/claude.exe` is likewise the full binary. In both
//      cases the realpath target is large → strings it directly.
//
//   2. npm with a JS shim: `which claude` → a few-KB `cli-wrapper.cjs`. Not
//      an executable → walk up to the platform sub-package
//      `node_modules/@anthropic-ai/claude-code-<platform>-<arch>/claude`.
//
// Before this handled layout #1, a native install (the default on a fresh
// `curl` install and on Claude Code self-updates) always returned null here,
// so listModels() silently served the stale STATIC_MODELS fallback no matter
// which CLI version was installed.
function _pickClaudeBinaryFromReal(real: string, fs: BinaryProbes): string | null {
  // Layout #1: the realpath target is already the executable (native install
  // `versions/<v>`, or npm `bin/claude.exe`). Strings it directly.
  if (fs.isExecutable(real)) return real;

  // Layout #2: realpath landed on a wrapper — walk to the npm sub-package.
  //   <pkg>/bin/claude.exe   → up two
  //   <pkg>/cli-wrapper.cjs  → up one
  //   <pkg>/<something-else> → up one (defensive default)
  const base = real.split('/').pop() ?? '';
  const pkgRoot =
    base === 'claude.exe' || base === 'claude' ? dirname(dirname(real)) : dirname(real);
  // Find the platform-specific sub-package. On Apple Silicon Macs this is
  // `claude-code-darwin-arm64`; the same scan works for Linux x64/arm64, so
  // we don't hardcode the suffix.
  const platformPkgDir = join(pkgRoot, 'node_modules', '@anthropic-ai');
  if (!fs.dirExists(platformPkgDir)) return null;
  for (const dir of fs.readdir(platformPkgDir).filter(n => n.startsWith('claude-code-'))) {
    const candidate = join(platformPkgDir, dir, 'claude');
    // Defense-in-depth: confirm the candidate lives where we expect before
    // shelling out to `strings` on it.
    if (fs.fileExists(candidate) && candidate.includes('/@anthropic-ai/claude-code-')) {
      return candidate;
    }
  }
  return null;
}

// Resolve the path to the real Claude Code executable so we can `strings`
// it for the model list. The user-facing `claude` on PATH is a symlink
// (native install) or wrapper (npm); `_pickClaudeBinaryFromReal` handles
// both layouts.
//
// Returns null if anything in the chain fails — caller falls back to
// STATIC_MODELS rather than crashing the Settings dropdown.
function _resolveClaudeBinary(): string | null {
  try {
    const which = execFileSync('which', ['claude'], {
      encoding: 'utf-8',
      timeout: 2000,
      env: withProviderCliPath(),
    }).trim();
    if (!which) return null;
    const real = realpathSync(which);
    return _pickClaudeBinaryFromReal(real, {
      isExecutable: p => {
        try {
          return statSync(p).size > CLAUDE_BINARY_MIN_BYTES;
        } catch {
          return false;
        }
      },
      dirExists: existsSync,
      readdir: readdirSync,
      fileExists: existsSync,
    });
  } catch {
    return null;
  }
}

// Extract model ids from the binary's compiled-in strings table. Returns
// a cleaned, sorted list — aliases are added by the caller.
function _extractModelsFromBinary(binPath: string): ModelChoice[] {
  // `strings` on a ~200MB binary runs in ~0.3s on a modern Mac. maxBuffer
  // must comfortably exceed the strings OUTPUT: Claude 2.1.205's binary
  // (237MB) emits ~33.6MB of strings, which overflowed the previous 32MB
  // cap — execFileSync threw and every install silently served the stale
  // STATIC_MODELS fallback (the 2026-07-09 mac-mini "old models" bug).
  // 256MB is above any possible output (strings emits a subset of the
  // binary) and maxBuffer is a cap, not a preallocation. The 15s timeout
  // is far above the observed worst case but bounds a hung `strings`.
  const out = execFileSync('strings', [binPath], {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 15_000,
  });
  // Match real id lines at line start. The character class deliberately
  // includes `[`, `]`, and `@` so we can capture `[1m]` context-window
  // variants and `@<date>` aliases — they get triaged below.
  const matches = out.match(/^claude-(?:opus|sonnet|haiku)-[0-9][0-9a-z.@[\]_-]*$/gm) ?? [];
  const cleaned = matches.filter(id => {
    // Drop regex-source strings the binary uses internally (e.g.
    // `claude-opus-4(?!-\d(?!\d))`). They look like ids at first glance
    // but contain regex metacharacters.
    if (id.includes('(') || id.includes('?')) return false;
    // Drop `@`-suffixed duplicates. The binary contains BOTH
    // `claude-opus-4-1-20250805` and `claude-opus-4-1@20250805`; the
    // `--model` flag canonicalizes to the dash form and the picker
    // shows the dash form, so the `@` form is noise.
    if (id.includes('@')) return false;
    return true;
  });
  // Deduplicate while preserving order, then sort: aliases sit at the
  // top of the final list; within the live-extracted set we group by
  // family (opus → sonnet → haiku) and sort descending within family so
  // the newest ids surface first in the picker dropdown.
  const unique = Array.from(new Set(cleaned));
  const familyOrder: Record<string, number> = { opus: 0, sonnet: 1, haiku: 2 };
  unique.sort((a, b) => {
    const fa = a.split('-')[1] ?? '';
    const fb = b.split('-')[1] ?? '';
    if (fa !== fb) return (familyOrder[fa] ?? 9) - (familyOrder[fb] ?? 9);
    return b.localeCompare(a); // descending within family
  });
  return unique.map(id => {
    // `[1m]` variants are valid `--model` inputs (e.g. `claude-opus-4-7[1m]`
    // selects the 1M-token-context build). Label them so users can tell
    // the context-window variant from the standard one in the dropdown.
    if (id.endsWith('[1m]')) {
      const base = id.slice(0, -'[1m]'.length);
      return { id, label: `${base} (1M context)` };
    }
    return { id, label: id };
  });
}

// Internals exported solely so tests can spy on the resolve + extract
// helpers without having to mock `node:child_process` / `node:fs`. Treat
// this as private surface; do not import from production code.
export const __testing = {
  resolveClaudeBinary: _resolveClaudeBinary,
  pickClaudeBinaryFromReal: _pickClaudeBinaryFromReal,
  extractModelsFromBinary: _extractModelsFromBinary,
  resetCache(): void {
    claudeModelsCache = null;
  },
};

// Chat spawns run WITHOUT --dangerously-skip-permissions: the allowlist
// grants exactly the read-only set + the sur9e-app MCP tools, and the
// denylist hard-blocks mutation tools (spec §3.7 — chat never gets
// Bash/Write/Edit; mutations go through confirm-gated MCP actions only).
const CHAT_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'mcp__sur9e-app__*',
  ...PLAYWRIGHT_CHAT_TOOLS.map(tool => `mcp__playwright__${tool}`),
].join(',');
const CHAT_DISALLOWED_TOOLS = 'Bash,Write,Edit,NotebookEdit,Task';

const claude: Provider = {
  id: 'claude',
  displayName: 'Claude Code',
  binary: 'claude',
  installHint: 'Claude Code is already required by sur9e — see https://docs.claude.com/code',

  buildHeadlessArgs(opts) {
    // Parameterized so the same builder serves all
    // three call sites: command-registry's stream-json + parser pipe,
    // batch/screen.mjs's single-object JSON + tool allowlist, and
    // batch/batch-runner.sh's plain-text invocation.
    //
    // The defaults reproduce today's command-registry invocation exactly,
    // so unparameterized callers (and the no-opts parity snapshot) are
    // unaffected. See `BuildHeadlessOpts` in types.ts for the mapping.
    //
    // Prompt quoting: legacy used `"${prompt}"` (vulnerable to `$`,
    // backticks, backslashes). We single-quote via `escapeForBash` so any
    // JD text, system message, or screener URL can't escape the shell arg.
    const {
      prompt,
      model,
      outputFormat = 'stream-json',
      tools,
      appendSystemPromptFile,
      skipPermissions = true,
      pipeToParser,
    } = opts;

    // Flag composition. Order is fixed to match the legacy snapshot exactly
    // when no extra opts are passed (parity guard in claude.test.ts +
    // command-registry-claude-parity.test.ts). New flags slot in after the
    // legacy four; reorder cautiously.
    //
    // `tools?.length` (not `tools`) so an explicit `tools: []` is treated
    // as "no restriction" — Boolean([]) is true and would otherwise emit
    // a bare `--tools ` which Claude rejects.
    const parts: string[] = [];
    if (skipPermissions) parts.push('--dangerously-skip-permissions');
    parts.push(`--model ${model}`);
    if (outputFormat === 'stream-json') {
      parts.push('--output-format stream-json', '--verbose');
    } else if (outputFormat === 'json') {
      parts.push('--output-format json');
    } // outputFormat === 'text' → omit --output-format entirely
    if (tools && tools.length > 0) parts.push(`--tools ${tools.join(',')}`);
    if (appendSystemPromptFile) {
      parts.push(`--append-system-prompt-file ${appendSystemPromptFile}`);
    }

    const usePipe = pipeToParser ?? outputFormat === 'stream-json';
    const pipe = usePipe ? ' | node cli/stream-claude-parser.mjs' : '';

    const cmdline = `claude -p ${parts.join(' ')} ${escapeForBash(prompt)}${pipe}`;
    return { cmd: '/bin/bash', args: ['-c', cmdline], env: providerCliEnv() };
  },

  buildInteractiveLaunch({ promptFilePath, model }) {
    // For interactive launch we hand the user a command they paste in a new
    // terminal; cleanest is `claude` interactive mode with the prompt loaded
    // from the tmp file via stdin redirect.
    return {
      cmd: '/bin/bash',
      args: ['-c', `claude --model ${model} < ${promptFilePath}`],
      env: providerCliEnv(),
    };
  },

  buildChatArgs({ promptFile, model, resumeSessionId, sessionId, mcpConfigPath }) {
    // resumeSessionId/sessionId are UUIDs minted by claude itself or by
    // crypto.randomUUID() in the turn runner — never user text. They're
    // still routed through escapeForBash as defense in depth (matching
    // buildHeadlessArgs's treatment of prompt/promptFile above), and
    // extractSessionId below gates any claude-emitted id through a strict
    // charset regex before it's ever stored or replayed here.
    const parts: string[] = [
      `--model ${escapeForBash(model)}`,
      '--output-format stream-json',
      '--verbose',
    ];
    if (resumeSessionId) parts.push(`--resume ${escapeForBash(resumeSessionId)}`);
    else if (sessionId) parts.push(`--session-id ${escapeForBash(sessionId)}`);
    // --strict-mcp-config makes the turn use ONLY this turn-scoped config and
    // ignore the project/user .mcp.json. Without it, the CLI (spawned with
    // cwd=repo root) also auto-loads the project .mcp.json, which registers a
    // second `sur9e-app` server WITHOUT the turn id (terminal mode) for
    // terminal agents — and undocumented merge precedence could let that one
    // win, silently dropping the turn id so the action layer skips the confirm
    // card. Pin the turn-scoped server so web-chat spend/writes always gate.
    if (mcpConfigPath) {
      parts.push(`--mcp-config ${escapeForBash(mcpConfigPath)}`);
      parts.push('--strict-mcp-config');
    }
    parts.push(`--allowedTools "${CHAT_ALLOWED_TOOLS}"`);
    parts.push(`--disallowedTools "${CHAT_DISALLOWED_TOOLS}"`);
    // Feed the prompt on stdin, NOT as a `"$(cat …)"` positional arg. When a
    // chat turn attaches an MCP server (--mcp-config), claude reads a positional
    // `-p` prompt racily against MCP-server startup and intermittently fails
    // with "Input must be provided … when using --print". Stdin redirection is
    // unambiguous — claude consumes the whole file then hits EOF and proceeds.
    // (Headless jobs never saw this: they attach no MCP server.)
    const cmdline = `claude -p ${parts.join(' ')} < ${escapeForBash(promptFile)}`;
    return { cmd: '/bin/bash', args: ['-c', cmdline], env: providerCliEnv() };
  },

  extractSessionId(streamLine) {
    if (!streamLine.trim()) return null;
    try {
      const obj = JSON.parse(streamLine);
      if (obj?.type === 'system' && obj?.subtype === 'init' && typeof obj.session_id === 'string') {
        // Gate against a malformed/hostile id before it ever becomes a
        // session handle (e.g. spliced into a future --resume flag). Claude
        // itself only ever emits UUIDs, so this should never reject a real
        // session id — it's a backstop, not the primary defense (the splice
        // points in buildChatArgs also route ids through escapeForBash).
        if (!/^[A-Za-z0-9._-]{1,128}$/.test(obj.session_id)) return null;
        return obj.session_id;
      }
    } catch {
      // not a JSON line
    }
    return null;
  },

  detectResumeFailure(stdout, stderr) {
    // Two independent signals, either suffices: the CLI's prose error on
    // stdout OR stderr, and the structured result event that errored before
    // completing a single turn (is_error with num_turns 0 — a mid-run error
    // has num_turns > 0 and must NOT reseed).
    const prose = /no conversation found with session id/i;
    if (prose.test(stdout) || prose.test(stderr)) return true;
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj?.type === 'result' && obj?.is_error === true && Number(obj?.num_turns) === 0) {
          return true;
        }
      } catch {
        // skip non-JSON lines
      }
    }
    return false;
  },

  parseStreamLine(line) {
    if (!line.trim()) return null;
    // Claude's --output-format stream-json schema is external and untyped;
    // we shrug at unknown shapes (return null) rather than crash, so a
    // CLI upgrade that adds a new event type degrades gracefully.
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }
    const ts = new Date().toISOString();
    // `system/init` is pure infrastructure (session id + model handshake), not
    // model output — surfacing it as a stage leaked an "init — model=…" line
    // into the chat transcript. Drop it.
    if (obj.type === 'system' && obj.subtype === 'init') {
      return null;
    }
    if (obj.type === 'assistant' && obj.message?.content) {
      for (const p of obj.message.content) {
        if (p.type === 'thinking') {
          return { kind: 'thinking', message: String(p.thinking ?? ''), ts };
        }
        if (p.type === 'tool_use') {
          const summary = p.input?.url || p.input?.command || p.input?.file_path || '';
          return {
            kind: 'tool',
            toolStatus: 'start',
            toolId: typeof p.id === 'string' ? p.id : undefined,
            message: `${p.name}${summary ? `: ${String(summary).slice(0, 120)}` : ''}`,
            ts,
          };
        }
        if (p.type === 'text') {
          return { kind: 'stage', message: String(p.text ?? '').slice(0, 200), ts };
        }
      }
    }
    // A tool's RESULT comes back on the next `user` message as a `tool_result`
    // part carrying the originating `tool_use_id` (never the tool's name). Emit
    // the closing tool event keyed by that id so the folder can resolve the
    // matching running chip — without this, every Claude tool chip spun
    // forever. `is_error` distinguishes a failed call (✕) from a clean one (✓).
    if (obj.type === 'user' && Array.isArray(obj.message?.content)) {
      for (const p of obj.message.content) {
        if (p?.type === 'tool_result') {
          return {
            kind: 'tool',
            toolStatus: p.is_error === true ? 'error' : 'done',
            toolId: typeof p.tool_use_id === 'string' ? p.tool_use_id : undefined,
            message: '',
            ts,
          };
        }
      }
    }
    if (obj.type === 'result') {
      // Claude's stream has no dedicated end-of-stream marker — `result` is
      // the terminal event. We map it to a `tokens` event so the unified
      // schema's `tokens` payload carries usage data; the `final` kind in
      // the schema is reserved for providers that DO emit an explicit
      // end-marker (e.g. codex). If downstream code needs a "stream is
      // over" signal for Claude, it can treat receipt of any `tokens`
      // event as the close — that's how command-registry consumers do it.
      const u = obj.usage ?? {};
      const tokens: UnifiedStreamEvent['tokens'] = {
        in: Number(u.input_tokens ?? 0),
        out: Number(u.output_tokens ?? 0),
        model: obj.model ?? 'unknown',
        estimated: false,
      };
      return {
        kind: 'tokens',
        message: `result: ${tokens.in} in / ${tokens.out} out`,
        tokens,
        ts,
      };
    }
    return null;
  },

  async listModels() {
    try {
      const installed = await this.checkInstalled();
      if (!installed.ok || !installed.version) {
        return STATIC_MODELS;
      }
      // Warm cache hit: identical version → reuse the prior extraction.
      if (claudeModelsCache && claudeModelsCache.version === installed.version) {
        return claudeModelsCache.models;
      }
      // Note: indirect through __testing so unit tests can `vi.spyOn` the
      // resolve + extract helpers without having to mock `node:child_process`
      // (vitest's node-builtin module mocking is unreliable here in practice).
      const binPath = __testing.resolveClaudeBinary();
      if (!binPath) {
        return STATIC_MODELS;
      }
      const liveModels = __testing.extractModelsFromBinary(binPath);
      if (liveModels.length === 0) {
        // Extraction succeeded but yielded nothing — treat as fallback.
        // (Should never happen in practice; the binary always has at least
        // a handful of ids, but this guards against a future strings(1)
        // misbehavior or a binary that's been stripped down somehow.)
        return STATIC_MODELS;
      }
      claudeModelsCache = { version: installed.version, models: liveModels };
      return liveModels;
    } catch {
      return STATIC_MODELS;
    }
  },

  async checkInstalled() {
    try {
      const out = execFileSync('claude', ['--version'], {
        encoding: 'utf-8',
        timeout: 3000,
        env: withProviderCliPath(),
      });
      const m = out.match(/(\d+\.\d+\.\d+)/);
      return { ok: true, version: m?.[1] };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  async checkAuth() {
    // Claude Code uses its own session — if `claude --version` succeeded,
    // assume auth is set up. We surface "not detected" only when --version
    // itself failed. (Intentional separation of concerns: checkAuth and
    // checkInstalled both probe the binary; the duplication is fine
    // because execFileSync is ~3ms.)
    const installed = await claude.checkInstalled();
    return installed.ok ? { ok: true } : { ok: false, warning: 'Run `claude` once to log in.' };
  },

  classifyExitError(stderr, _code) {
    return classifyProviderError('claude', stderr) as ExitClassification;
  },
};

export default claude;
