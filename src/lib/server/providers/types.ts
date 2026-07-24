// src/lib/server/providers/types.ts
//
// The Provider interface — the contract every CLI adapter implements
// (claude.ts first, then codex.ts / opencode.ts).
// Pure type module: no runtime code, no zod parsing here. The concrete
// adapters import this and the zod schemas in lib/schemas/providers.
//
// Shape of an adapter:
//   - identity + binary metadata (id, displayName, binary, installHint)
//   - argv builders for both spawn modes (headless NDJSON, interactive TTY)
//   - one-line NDJSON parser → UnifiedStreamEvent (the shared event shape
//     downstream UI/stage code consumes; provider swaps stay adapter-local)
//   - model + health + auth probes used by the picker, doctor, and the
//     pre-spawn capability check
//   - stderr/exit-code classifier so the dispatcher can map raw failures
//     onto a small UX-friendly enum
//
// Lives under server/ because Provider implementations spawn child
// processes — server-only enforces no accidental client import.

import 'server-only';
import type { ProviderId, UnifiedStreamEvent } from '../../schemas/providers';

export type ExitClassification =
  | 'auth'
  | 'rate_limit'
  | 'model_not_found'
  | 'overloaded'
  | 'quota'
  | 'context_overflow'
  | 'install'
  | 'unknown';

/**
 * Options for `Provider.buildHeadlessArgs` — the parameterized headless
 * invocation builder. Today three call sites need three different argv
 * shapes:
 *
 *   - `command-registry.ts` (evaluate / research / outreach / interview-prep /
 *     tailor-cv / cover-letter): NDJSON stream piped into the parser.
 *     Uses the defaults — pass only `{prompt, model}`.
 *
 *   - `batch/screen.mjs` (URL screener): single-object JSON output (consumer
 *     calls `JSON.parse(stdout)`), restricted tool subset, system prompt
 *     loaded from a file, no parser pipe.
 *     Pass `{outputFormat: 'json', pipeToParser: false, tools: ['WebFetch','Write'],
 *           appendSystemPromptFile: '/abs/path'}`.
 *
 *   - `batch/batch-runner.sh` (offer batch worker): plain text output, no
 *     `--output-format` flag at all, no parser pipe, system prompt from file.
 *     Pass `{outputFormat: 'text', pipeToParser: false,
 *           appendSystemPromptFile: '/abs/path'}`.
 *
 * Codex / OpenCode adapters implement the same opts;
 * `tools` may degrade gracefully on adapters whose CLI lacks an allowlist
 * flag, and `outputFormat: 'json'` maps to whatever single-object mode the
 * target CLI exposes (e.g. `--json` on codex).
 */
export type BuildHeadlessOpts = {
  /** User prompt body — adapter must shell-escape before splicing. */
  prompt: string;
  /**
   * Model id to pass through to the CLI. Always required; batch callers that
   * previously relied on a CLI-side default should resolve via
   * `resolveModeRuntime(...).model` (which has its own fallback waterfall)
   * and pass the resolved id here.
   */
  model: string;
  /**
   * Output format the CLI should emit.
   *   - `'stream-json'` (default): NDJSON event stream (Claude's
   *     `--output-format stream-json --verbose` shape). Pipes by default.
   *   - `'json'`: a single JSON object on stdout — caller parses with
   *     `JSON.parse(stdout)`. Used by `batch/screen.mjs`.
   *   - `'text'`: plain text — omit `--output-format` entirely. Used by
   *     `batch/batch-runner.sh`.
   */
  outputFormat?: 'stream-json' | 'json' | 'text';
  /**
   * Pipe stdout into the unified stream parser
   * (`cli/stream-claude-parser.mjs`). Defaults to `true` when
   * `outputFormat === 'stream-json'`, `false` otherwise. Pass `false`
   * explicitly to suppress the pipe even with stream-json output.
   */
  pipeToParser?: boolean;
  /**
   * Optional allow-list of tool names the CLI may use. Maps to
   * `--tools T1,T2,...`. Empty arrays are treated as "no restriction"
   * (omit the flag entirely). Pass `undefined` for the CLI's default
   * (full toolset).
   */
  tools?: string[];
  /**
   * Absolute path to a system-prompt file appended via
   * `--append-system-prompt-file`. Caller is responsible for path
   * containment (the adapter does not validate this against rootPath).
   */
  appendSystemPromptFile?: string;
  /**
   * Include `--dangerously-skip-permissions`. Defaults to `true` to match
   * today's command-registry behavior; pass `false` to keep the CLI's
   * interactive permission prompt.
   */
  skipPermissions?: boolean;
};

export type BuildInteractiveOpts = {
  prompt: string; // raw prompt body
  model: string;
  promptFilePath: string; // tmp file path the helper has already written
};

/**
 * Options for `Provider.buildChatArgs` — the headless streaming invocation
 * for one chat turn (design spec §3.1). Unlike BuildHeadlessOpts the prompt
 * arrives as a FILE (turn prompts can embed a full reseed transcript; argv
 * length is bounded, tmp files are not): the command substitutes it in via
 * `"$(cat '<promptFile>')"`. The turn runner sets at most one of
 * resumeSessionId / sessionId: resumeSessionId continues a provider-native
 * session, sessionId names a fresh one so the runner can store the id even
 * if the CLI never echoes it back.
 */
export type BuildChatArgsOpts = {
  /** Absolute path to a tmp file holding the full turn prompt. Path is shell-escaped via escapeForBash at the sink, so caller does not need to pre-sanitize. */
  promptFile: string;
  /** Model id — already validated through ProviderModelRef by runtime resolution. */
  model: string;
  /** Provider-native session id to resume. Omit for a fresh session. */
  resumeSessionId?: string;
  /** Caller-chosen id for a FRESH session (claude --session-id). Ignored when resuming. */
  sessionId?: string;
  /** MCP config file to attach (claude --mcp-config). Wired by the MCP actions plan. */
  mcpConfigPath?: string;
};

export type SpawnArgs = {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
};

export type ModelChoice = {
  id: string;
  label: string;
};

export type ProviderHealth = {
  ok: boolean;
  version?: string;
  error?: string;
};

export type Provider = {
  id: ProviderId;
  displayName: string;
  binary: string;
  installHint: string;

  buildHeadlessArgs(opts: BuildHeadlessOpts): SpawnArgs;
  buildInteractiveLaunch(opts: BuildInteractiveOpts): SpawnArgs;

  buildChatArgs(opts: BuildChatArgsOpts): SpawnArgs;

  /**
   * Parse a provider session id out of one stdout line (claude: the
   * stream-json init event's session_id). Null when the line carries none.
   */
  extractSessionId(streamLine: string): string | null;

  /**
   * True when a finished run failed BECAUSE the resumed session no longer
   * exists on the provider side (→ the turn runner reseeds). Must stay
   * false for ordinary failures — a rate-limit must not trigger a reseed.
   */
  detectResumeFailure(stdout: string, stderr: string): boolean;

  parseStreamLine(line: string): UnifiedStreamEvent | null;

  listModels(): Promise<ModelChoice[]>;

  checkInstalled(): Promise<ProviderHealth>;
  checkAuth(): Promise<{ ok: boolean; warning?: string }>;

  classifyExitError(stderr: string, code: number): ExitClassification;
};
