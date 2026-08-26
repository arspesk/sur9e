// src/lib/server/providers/humanize-error.ts
//
// Turn-error humanizer: turns a raw provider CLI failure (a non-zero exit's
// stderr tail, a `spawn <bin> ENOENT`, or an internal prologue throw) into a
// short, ACTIONABLE sentence the chat bubble can show — never a raw stderr
// dump, a bare Node error, terminal escape noise, a `<<<SUR9E_*>>>` sentinel,
// or an HTML error tail.
//
// The templates and the stdout pre-filter live in the framework-neutral
// src/lib/provider-error-message.ts (shared with the job runner and the
// client-side jobs strip); this module adds the chat-turn specifics: the
// stdout+stderr assembly and the signal-kill short-circuit. Every returned
// message is a STATIC template, so no raw provider text can leak to the user.

import 'server-only';
import { describeProviderFailure, providerLabel } from '../../provider-error-message';

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

/**
 * Classify a chat-turn failure and return a clean, actionable message + its
 * category. `provider` is the provider id ('claude'|'codex'|'opencode');
 * `stdout`/`stderr`/`code` are whatever the turn captured (on a spawn or
 * prologue failure, pass the Error.message as `stderr`).
 *
 * stdout is a stream-json event log, most of which is infrastructure (the
 * `system/init` handshake, hook events, usage). describeProviderFailure keeps
 * only the failure-bearing text — result/error/assistant strings plus plain
 * lines — so a handshake field can never out-rank the real error (issue #120).
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
  return describeProviderFailure(provider, `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`);
}
