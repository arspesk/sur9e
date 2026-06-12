// Re-export the elapsed formatter that lives in the store so sub-components
// can import from a single, non-store path. parseLogLines, deriveElapsed,
// and capitalise are local to this file.
export { fmtElapsed } from './loading-modal-store';

export function deriveElapsed(startedAtIso?: string, finishedAtIso?: string | null): number {
  if (!startedAtIso) return 0;
  const t0 = new Date(startedAtIso).getTime();
  if (Number.isNaN(t0)) return 0;
  // Terminal jobs freeze at their real duration instead of ticking wall-clock.
  const tEnd = finishedAtIso ? new Date(finishedAtIso).getTime() : Number.NaN;
  const end = Number.isNaN(tEnd) ? Date.now() : tEnd;
  return Math.max(0, Math.floor((end - t0) / 1000));
}

export function parseLogLines(output: string, max = 200): string[] {
  if (!output) return [];
  return output
    .split('\n')
    .filter(l => l.trim())
    .slice(-max);
}

export function capitalise(s: string): string {
  if (!s) return 'Working';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
