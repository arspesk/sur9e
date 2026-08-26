// src/lib/provider-error-message.ts
//
// Framework-neutral half of provider-failure humanizing: the category →
// actionable one-liner templates, the provider labels, and the pre-filter
// that reduces a raw CLI stdout/stderr blob to the text that actually
// describes the failure before it reaches cli/classify-error.mjs.
//
// No Node, React, or `server-only` imports — usable from the chat turn runner
// (src/lib/server/providers/humanize-error.ts), the job runner
// (src/lib/server/jobs/runner.ts), AND the client-side jobs strip
// (src/features/chat/chat-jobs-slot.tsx), so every surface that shows a
// provider failure renders the same sentence for the same category.
//
// Every returned message is a STATIC template — the failure text is only ever
// read for classification, never spliced into the output — so no raw provider
// text (ANSI, sentinels, stack frames, HTML tails) can leak to the user.

import { classifyProviderError } from '../../cli/classify-error.mjs';
import { stripTerminalNoise } from './terminal-noise';

export type ProviderFailureDescription = {
  /** Clean, user-facing sentence — safe to render verbatim. */
  message: string;
  /** The classify-error category ('auth'|'quota'|…|'unknown'). */
  category: string;
};

// Friendly display names for the message body. Kept local (rather than
// reading Provider.displayName) so this stays a pure string→string module.
// Unknown ids degrade gracefully.
const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? 'the AI provider';
}

// Auth failures are CLI-session failures: each provider CLI has its own login
// command, and that — not an API key field — is the remediation (issue #120:
// an expired Claude OAuth session needs `claude auth login`).
const AUTH_MESSAGE_BY_PROVIDER: Record<string, string> = {
  claude:
    'Your Claude session has expired or is signed out — run "claude auth login" in a terminal, then try again.',
  codex: 'Your Codex session is signed out — run "codex login" in a terminal, then try again.',
  opencode:
    'OpenCode couldn\'t authenticate with its provider — run "opencode auth login" (or set the provider\'s API key env var), then try again.',
};

// Category → actionable one-liner. Every entry is a static template; the raw
// failure text is NEVER interpolated.
const MESSAGE_BY_CATEGORY: Record<string, (provider: string, label: string) => string> = {
  auth: (provider, label) =>
    AUTH_MESSAGE_BY_PROVIDER[provider] ??
    `Your ${label} credentials aren't working — sign in to its CLI again, then try again.`,
  quota: (_p, label) => `You've hit ${label}'s rate limit or quota — wait a bit or switch model.`,
  rate_limit: (_p, label) =>
    `You've hit ${label}'s rate limit or quota — wait a bit or switch model.`,
  model_not_found: () => `That model isn't available — pick another from the model menu.`,
  overloaded: (_p, label) => `${label} returned an error — try again or switch model.`,
  context_overflow: () =>
    `This conversation got too long for the model — start a new chat or switch to a bigger-context model.`,
  install: (_p, label) =>
    `Couldn't launch the ${label} CLI — make sure it's installed and on your PATH.`,
  unknown: (_p, label) => `${label} couldn't complete this reply — try again or switch model.`,
};

/** True for a category that has a specific (non-`unknown`) template. */
export function isActionableCategory(category: string | undefined | null): category is string {
  return typeof category === 'string' && category !== 'unknown' && category in MESSAGE_BY_CATEGORY;
}

/** The static template for a classify-error category (unknown ids/categories degrade gracefully). */
export function providerErrorMessage(provider: string, category: string): string {
  const build = MESSAGE_BY_CATEGORY[category] ?? MESSAGE_BY_CATEGORY.unknown;
  return build(provider, providerLabel(provider));
}

const SENTINEL_RE = /<<<SUR9E_[A-Z_]*>>>/g;

/** A string field, or the `message` of an error object, as text. */
function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const msg = (value as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return '';
}

/**
 * Reduce a provider CLI's captured output to the lines that can describe a
 * FAILURE. Structured (JSON-per-line) stream events are pure infrastructure
 * unless they carry model text or an error: the claude `system/init`
 * handshake, for instance, lists the CLI's slash commands (`usage-credits`
 * among them on 2.1.x), which used to trip the quota needle ahead of the real
 * auth failure (issue #120). Keep, per JSON line: `result`, `error`, `message`
 * strings and assistant text parts; drop everything else. Plain (non-JSON)
 * lines — stderr prose, `❌`/`ERROR:` worker lines — pass through untouched.
 * Terminal escapes and `<<<SUR9E_*>>>` sentinels are stripped so an escape
 * spliced mid-token can't hide a signature.
 */
export function failureTextForClassification(text: string): string {
  const out: string[] = [];
  for (const line of stripTerminalNoise(text).replace(SENTINEL_RE, '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('{')) {
      out.push(trimmed);
      continue;
    }
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      out.push(trimmed); // not actually JSON — keep as prose
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const kept: string[] = [];
    if (typeof obj.result === 'string') kept.push(obj.result);
    kept.push(errorText(obj.error));
    // Top-level `message` (codex `{"type":"error","message":…}`), or a claude
    // `assistant` envelope whose message.content carries text parts.
    if (typeof obj.message === 'string') kept.push(obj.message);
    else if (obj.message && typeof obj.message === 'object') {
      const content = (obj.message as { content?: unknown }).content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === 'object' &&
            typeof (part as { text?: unknown }).text === 'string'
          ) {
            kept.push((part as { text: string }).text);
          }
        }
      }
    }
    const joined = kept.filter(Boolean).join('\n');
    if (joined) out.push(joined);
  }
  return out.join('\n');
}

/**
 * Classify a provider failure from its captured text (stdout, stderr, or a
 * persisted error line) and return the matching template + category.
 */
export function describeProviderFailure(
  provider: string,
  text: string,
): ProviderFailureDescription {
  const category = classifyProviderError(provider, failureTextForClassification(text));
  return { message: providerErrorMessage(provider, category), category };
}
