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
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { classifyProviderError } from '../../../../cli/classify-error.mjs';
import type { UnifiedStreamEvent } from '../../schemas/providers';
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

// Resolve the path to the actual platform-arch binary inside the
// `@anthropic-ai/claude-code` npm package. The user-facing `claude` on
// PATH is a wrapper (`bin/claude.exe` or `cli-wrapper.cjs`); `strings`
// needs the real Mach-O / ELF executable that sits one level deeper, in
// `node_modules/@anthropic-ai/claude-code-<platform>-<arch>/claude`.
//
// Returns null if anything in the chain fails — caller falls back to
// STATIC_MODELS rather than crashing the Settings dropdown.
function _resolveClaudeBinary(): string | null {
  try {
    const which = execFileSync('which', ['claude'], { encoding: 'utf-8', timeout: 2000 }).trim();
    if (!which) return null;
    // Resolve the wrapper through any symlinks. On a typical macOS install
    // this lands on `.../@anthropic-ai/claude-code/bin/claude.exe` (yes,
    // `.exe` even on macOS — that's how Anthropic ships it).
    const real = realpathSync(which);
    // Walk up to the npm package root. Handle both wrapper layouts:
    //   <pkg>/bin/claude.exe        → up two
    //   <pkg>/cli-wrapper.cjs       → up one
    //   <pkg>/<something-else>      → up one (defensive default)
    const base = real.split('/').pop() ?? '';
    const pkgRoot =
      base === 'claude.exe' || base === 'claude' ? dirname(dirname(real)) : dirname(real);
    // Find the platform-specific sub-package. On Apple Silicon Macs this
    // is `claude-code-darwin-arm64`; the same scan works for Linux x64,
    // Linux arm64, etc., so we don't hardcode the suffix.
    const platformPkgDir = join(pkgRoot, 'node_modules', '@anthropic-ai');
    if (!existsSync(platformPkgDir)) return null;
    const candidates = readdirSync(platformPkgDir).filter(n => n.startsWith('claude-code-'));
    for (const dir of candidates) {
      const candidate = join(platformPkgDir, dir, 'claude');
      if (existsSync(candidate)) {
        // Defense-in-depth: confirm the candidate path lives where we
        // expect it to before shelling out to `strings` on it. The path
        // came from `which claude` so it's already trusted, but a one-line
        // guard reads cleanly and avoids surprises with weird symlinks.
        if (candidate.includes('/@anthropic-ai/claude-code-')) return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Extract model ids from the binary's compiled-in strings table. Returns
// a cleaned, sorted list — aliases are added by the caller.
function _extractModelsFromBinary(binPath: string): ModelChoice[] {
  // `strings` on a ~200MB binary runs in ~0.3s on a modern Mac. The
  // ~32MB buffer is generous — the strings output is much smaller than
  // the binary itself — and the 15s timeout is far above the observed
  // worst case but still bounds us if `strings` ever hangs.
  const out = execFileSync('strings', [binPath], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
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
  extractModelsFromBinary: _extractModelsFromBinary,
  resetCache(): void {
    claudeModelsCache = null;
  },
};

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
    return { cmd: '/bin/bash', args: ['-c', cmdline] };
  },

  buildInteractiveLaunch({ promptFilePath, model }) {
    // For interactive launch we hand the user a command they paste in a new
    // terminal; cleanest is `claude` interactive mode with the prompt loaded
    // from the tmp file via stdin redirect.
    return {
      cmd: '/bin/bash',
      args: ['-c', `claude --model ${model} < ${promptFilePath}`],
    };
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
    if (obj.type === 'system' && obj.subtype === 'init') {
      return { kind: 'stage', message: `init — model=${obj.model ?? '?'}`, ts };
    }
    if (obj.type === 'assistant' && obj.message?.content) {
      for (const p of obj.message.content) {
        if (p.type === 'thinking') {
          return { kind: 'thinking', message: String(p.thinking ?? '').slice(0, 200), ts };
        }
        if (p.type === 'tool_use') {
          const summary = p.input?.url || p.input?.command || p.input?.file_path || '';
          return {
            kind: 'tool',
            message: `${p.name}${summary ? `: ${String(summary).slice(0, 120)}` : ''}`,
            ts,
          };
        }
        if (p.type === 'text') {
          return { kind: 'stage', message: String(p.text ?? '').slice(0, 200), ts };
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
      const out = execFileSync('claude', ['--version'], { encoding: 'utf-8', timeout: 3000 });
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
