// src/lib/server/providers/humanize-error.ts
//
// Turn-error humanizer: turns a raw provider CLI failure (a non-zero exit's
// stderr tail, a `spawn <bin> ENOENT`, or an internal prologue throw) into a
// short, ACTIONABLE sentence the chat bubble can show — never a raw stderr
// dump, a bare Node error, terminal escape noise, a `<<<SUR9E_*>>>` sentinel,
// or an HTML error tail.
//
// It leans on cli/classify-error.mjs — the single source of truth for "what
// kind of failure was this" (auth/quota/rate_limit/model_not_found/…) — and
// maps each category to one clean line. Because every returned message is a
// STATIC template (the failure text is only ever read for classification,
// never spliced into the output), no raw provider text can leak to the user.

import 'server-only';
import { classifyProviderError } from '../../../../cli/classify-error.mjs';

export type HumanizedError = {
  /** Clean, user-facing sentence — safe to render verbatim in the chat bubble. */
  message: string;
  /** The classify-error category ('auth'|'quota'|…|'unknown'); flows onto the error event. */
  category: string;
};

export type ProviderFailure = {
  /** Captured stdout of the failed run (empty on a spawn/prologue failure). */
  stdout?: string;
  /** Captured stderr, or the Error.message on a spawn/prologue failure. */
  stderr?: string;
  /** Exit code when the child ran; null/undefined on spawn/prologue failure. */
  code?: number | null;
};

// Friendly display names for the message body. Kept local (rather than reading
// Provider.displayName) so this module stays a pure string→string function the
// tests can exercise with just a provider id. Unknown ids degrade gracefully.
const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? 'the AI provider';
}

// Category → actionable one-liner. Every entry is a static template; the raw
// failure text is NEVER interpolated, so ANSI/sentinel/HTML noise can't leak.
const MESSAGE_BY_CATEGORY: Record<string, (label: string) => string> = {
  auth: label => `Your ${label} credentials aren't working — check the API key in Settings.`,
  quota: label => `You've hit ${label}'s rate limit or quota — wait a bit or switch model.`,
  rate_limit: label => `You've hit ${label}'s rate limit or quota — wait a bit or switch model.`,
  model_not_found: () => `That model isn't available — pick another from the model menu.`,
  overloaded: label => `${label} returned an error — try again or switch model.`,
  context_overflow: () =>
    `This conversation got too long for the model — start a new chat or switch to a bigger-context model.`,
  install: label => `Couldn't launch the ${label} CLI — make sure it's installed and on your PATH.`,
  unknown: label => `${label} couldn't complete this reply — try again or switch model.`,
};

// Terminal pollution some CLIs interleave with their output — CSI color codes
// (`ESC[0m`), OSC sequences (`ESC]777;…BEL`), and ESC-stripped remnants. Mirror
// of batch/lib/output-parser.mjs's stripTerminalNoise, inlined here so the chat
// server bundle doesn't pull that module's js-yaml dependency in. Stripped
// BEFORE classification so an escape code spliced mid-token can't hide a
// signature — the RETURNED message is a static template regardless, so this is
// purely to sharpen the category match.
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const SENTINEL_RE = /<<<SUR9E_[A-Z_]*>>>/g;

function cleanForClassification(text: string): string {
  return text
    .replace(ANSI_OSC_RE, '')
    .replace(ANSI_CSI_RE, '')
    .replace(/\[[0-9;]{1,6}m/g, '')
    .replace(SENTINEL_RE, '');
}

/**
 * Classify a chat-turn failure and return a clean, actionable message + its
 * category. `provider` is the provider id ('claude'|'codex'|'opencode');
 * `stdout`/`stderr`/`code` are whatever the turn captured (on a spawn or
 * prologue failure, pass the Error.message as `stderr`).
 */
export function humanizeProviderError(provider: string, failure: ProviderFailure): HumanizedError {
  // A null exit code means the child was killed by a SIGNAL (OOM, crash, an
  // external kill) rather than exiting normally — the close handler passes
  // `code: null`. Its partial stdout is unreliable to classify: a mid-stream
  // token can coincidentally match a rate-limit/quota/etc. needle (observed:
  // a SIGTERM'd opencode turn mis-read as "rate limit"). Short-circuit to a
  // clear "interrupted" line instead of pattern-matching noise. (Spawn/prologue
  // failures pass no `code` at all → `undefined`, not `null`, so they still
  // classify — catching e.g. ENOENT → install.)
  if (failure.code === null) {
    return {
      message: `The ${providerLabel(provider)} reply was interrupted before it finished — try again.`,
      category: 'interrupted',
    };
  }
  const combined = cleanForClassification(`${failure.stdout ?? ''}\n${failure.stderr ?? ''}`);
  const category = classifyProviderError(provider, combined);
  const build = MESSAGE_BY_CATEGORY[category] ?? MESSAGE_BY_CATEGORY.unknown;
  return { message: build(providerLabel(provider)), category };
}
