// SPDX-License-Identifier: MIT
// cli/classify-error.mjs
//
// Pure provider-error classifier — the single source of truth for "what kind
// of failure was this" across the TS adapter layer (Provider.classifyExitError
// in src/lib/server/providers/*.ts) and the plain-node batch workers
// (batch/lib/llm.mjs fallback retry). Library module like usage-tracker.mjs:
// no shebang, no I/O, no server-only guard — importable from both worlds.
//
// Signatures are doc/source-grounded (researched 2026-06-06):
//   claude   — code.claude.com/docs cli-reference + errors + headless;
//              platform.claude.com/docs/en/api/errors
//   codex    — openai/codex codex-rs/protocol/src/error.rs #[error] strings,
//              exec_events.rs (turn.failed carries a flat message string)
//   opencode — sst/opencode session/retry.ts, provider/provider.ts,
//              cli/error.ts (NamedError names appear in output)
//
// Matching is case-insensitive substring, first-match-wins in category order.
// Order matters: e.g. codex's quota message contains "Switch to another
// model" — `quota` is checked before `model_not_found` would ever see it.

/**
 * @typedef {'auth'|'rate_limit'|'model_not_found'|'overloaded'|'quota'|'context_overflow'|'install'|'unknown'} ErrorCategory
 */

const SHARED = {
  install: ['command not found', 'enoent'],
  rate_limit: ['rate limit', 'too many requests', '429'],
  overloaded: ['overloaded'],
  auth: ['unauthorized', 'api key', 'not authenticated'],
};

const PROVIDER_SIGNATURES = {
  claude: {
    install: [],
    quota: ['session limit', 'credit balance is too low'],
    auth: ['oauth token revoked', 'not logged in', 'authentication_error'],
    model_not_found: [
      'issue with the selected model',
      'model not found',
      'unknown model',
      ['invalid_request_error', 'model'],
    ],
    rate_limit: ['rate_limit_error'],
    overloaded: ['overloaded_error', '529'],
    context_overflow: ['max_output_tokens', 'prompt is too long', 'context window'],
  },
  codex: {
    install: ['codex: command'],
    quota: ['usage limit', 'out of credits', 'quota exceeded', 'switch to another model'],
    auth: ['openai_api_key', 'refresh token', 'device code authentication'],
    model_not_found: [
      'model_not_found',
      'does not exist',
      // ChatGPT-account flow (vs API account) words the 400 differently —
      // observed live on codex-cli 0.133.0: "The 'gpt-x' model is not
      // supported when using Codex with a ChatGPT account."
      'model is not supported',
      ['invalid_request_error', 'model'],
    ],
    rate_limit: ['exceeded retry limit, last status: 429'],
    overloaded: ['at capacity'],
    context_overflow: ['context window'],
  },
  opencode: {
    install: ['opencode: command'],
    quota: ['usage limit', 'quota exceeded', 'freeusagelimiterror', 'gousagelimiterror'],
    auth: ['providerautherror', 'opencode auth login'],
    model_not_found: ['providermodelnotfounderror', 'model not found'],
    rate_limit: ['rate limited'],
    overloaded: ['provider is overloaded'],
    context_overflow: ['contextoverflowerror', 'context_length_exceeded'],
  },
};

// quota/auth/install BEFORE model_not_found and rate_limit: quota and auth
// messages often mention models or carry HTTP codes that the broader
// categories would mis-grab (e.g. codex's "Switch to another model now").
// context_overflow BEFORE model_not_found: both can carry invalid_request_error,
// but an over-long prompt must NOT retry, so it has to win first.
const CATEGORY_ORDER = [
  'install',
  'quota',
  'auth',
  'context_overflow',
  'model_not_found',
  'overloaded',
  'rate_limit',
];

// Categories that justify a one-shot retry on the fallback pair. `auth`
// (user must re-login), `context_overflow` (fails again), and `unknown`
// (not model-related per the design decision) are deliberately excluded.
const RETRYABLE = new Set(['model_not_found', 'rate_limit', 'overloaded', 'quota', 'install']);

/**
 * Classify a provider CLI failure from its combined stdout+stderr text.
 * @param {string} provider - 'claude' | 'codex' | 'opencode' (unknown ids use shared needles only)
 * @param {string} text - combined output of the failed run
 * @returns {ErrorCategory}
 */
export function classifyProviderError(provider, text) {
  const s = String(text ?? '').toLowerCase();
  const sigs = PROVIDER_SIGNATURES[provider] ?? {};
  for (const category of CATEGORY_ORDER) {
    const needles = [...(sigs[category] ?? []), ...(SHARED[category] ?? [])];
    if (needles.some(n => (Array.isArray(n) ? n.every(p => s.includes(p)) : s.includes(n))))
      return category;
  }
  return 'unknown';
}

/**
 * @param {string} category
 * @returns {boolean} whether the category triggers a fallback retry
 */
export function isRetryable(category) {
  return RETRYABLE.has(category);
}
