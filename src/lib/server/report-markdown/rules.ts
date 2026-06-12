// src/lib/server/report-markdown/rules.ts
//
// Rule registry: the variant/emoji maps and sanctioned palette shared by the
// auto-fixers and validators. Framework-free constants only.

export type CalloutVariant = 'info' | 'warn' | 'success' | 'error';
export const CALLOUT_VARIANTS: readonly CalloutVariant[] = ['info', 'warn', 'success', 'error'];

/** Leading-emoji -> variant for blockquote-callout conversion. */
export const EMOJI_TO_VARIANT: Record<string, CalloutVariant> = {
  '✅': 'success',
  '⚠️': 'warn',
  '🛑': 'error',
  '💡': 'info',
  '📭': 'warn',
  '🎯': 'info',
  '🗂️': 'info',
};

/** Obsidian alert kind -> variant. */
export const OBSIDIAN_TO_VARIANT: Record<string, CalloutVariant> = {
  note: 'info',
  info: 'info',
  tip: 'success',
  success: 'success',
  warning: 'warn',
  caution: 'warn',
  callout: 'info',
  danger: 'error',
  error: 'error',
};

/** Sanctioned emoji palette (Section 8.1). Off-palette = generation warn only. */
export const SANCTIONED_EMOJI = new Set(['🛑', '✅', '⚠️', '📭', '🎯', '🗂️', '💡']);
