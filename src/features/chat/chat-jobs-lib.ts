// Pure helpers for the chat jobs strip — ported verbatim from the retired
// loading-modal deck (phases.ts + LoadingModalCard derivations). No React,
// no store imports: safe from any client module.

import { JOB_TYPES_BY_TYPE } from '@/lib/job-types';
import {
  describeProviderFailure,
  isActionableCategory,
  providerErrorMessage,
} from '@/lib/provider-error-message';
import { cleanErrorLine, sanitizeJobLogLines } from '@/lib/terminal-noise';

/** 83 → "1:23". */
export function fmtElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function deriveElapsed(startedAtIso?: string, finishedAtIso?: string | null): number {
  if (!startedAtIso) return 0;
  const t0 = new Date(startedAtIso).getTime();
  if (Number.isNaN(t0)) return 0;
  // Terminal jobs freeze at their real duration instead of ticking wall-clock.
  const tEnd = finishedAtIso ? new Date(finishedAtIso).getTime() : Number.NaN;
  const end = Number.isNaN(tEnd) ? Date.now() : tEnd;
  return Math.max(0, Math.floor((end - t0) / 1000));
}

/** Clean, display-ready log lines for the strip's log pane. Delegates to the
 * shared sanitizer so raw ANSI escapes, leaked `<<<SUR9E_*>>>` sentinels, and
 * HTML error-page tails from a failed run never render. */
export function parseLogLines(output: string, max = 200): string[] {
  return sanitizeJobLogLines(output, max);
}

export function capitalise(s: string): string {
  if (!s) return 'Working';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 'tailor-cv' + 2 → 'Tailor CV · #2'. Short and constant across states so
 * it never truncates; numless system jobs (scan, batch) show just the kind. */
export function jobTitle(kind: string, num?: number): string {
  const kindLabel = capitalise(kind.replace(/-/g, ' ').replace(/\bcv\b/i, 'CV'));
  return num != null ? `${kindLabel} · #${num}` : kindLabel;
}

/** Time-based progress: elapsed over the registry's rough estimate
 * (JOB_TYPES estimateS), capped at 96% so the bar never claims "done" while
 * the job is still running. Overdue jobs just sit at the cap. */
export function timePercent(elapsedS: number, kind: string): number {
  const estimateS = JOB_TYPES_BY_TYPE[kind]?.estimateS ?? 300;
  return Math.min(96, Math.round((elapsedS / estimateS) * 100));
}

/** Where a done row's primary action navigates. Offer-scoped jobs carry a
 * num (stamped on params by the runner for screen jobs) and open that
 * report; numless system jobs (scan, batch-evaluate) have no single report
 * — their primary becomes "View offers". Structural param type avoids a
 * lib→store import. */
export function reportTarget(entry: {
  num?: number;
  snapshot: { params?: { num?: number; id?: string } } | null;
}): number | string | undefined {
  return entry.snapshot?.params?.num ?? entry.snapshot?.params?.id ?? entry.num;
}

/**
 * The failed-job card's subtitle. The runner already persists a humanized
 * cause (plus its `errorCategory`) when it recognised a provider failure, so a
 * known category renders that category's template directly. A record WITHOUT a
 * category — legacy on-disk records, or a raw value set by the poll layer — is
 * run through the same classifier here so an expired-session error still reads
 * "log back in" instead of leaking the raw provider line (issue #120). Anything
 * unrecognised falls back to the scrubbed worker cause (never ANSI, never a
 * `<<<SUR9E_*>>>` sentinel).
 */
export function jobErrorText(snapshot: {
  error?: string;
  errorCategory?: string;
  provider?: string;
}): string {
  const raw = snapshot.error ?? '';
  if (!raw) return '';
  const provider = snapshot.provider ?? 'claude';
  if (isActionableCategory(snapshot.errorCategory)) {
    return providerErrorMessage(provider, snapshot.errorCategory);
  }
  const { message, category } = describeProviderFailure(provider, raw);
  return isActionableCategory(category) ? message : cleanErrorLine(raw);
}
