/* features/report/report-kebab-config.ts
 *
 * Per-status map of the *interactive* (non-generator) modes that surface
 * inside the report and row kebab menus. Generator modes (Evaluate, Tailor CV,
 * Cover letter, Research, Reach out, Interview prep, Negotiate) live in
 * the slash menu — see mode-slash-items.ts.
 *
 * Only two interactive modes today:
 *   - apply    → CLI handoff modal (Screened + Evaluated)
 *   - follow-up → CLI handoff modal
 *
 * The status → action mapping mirrors public/report-toolbar-config.js
 * STATUS_ACTIONS without the generator entries.
 */

import type { ReportR } from './report-types';

export type InteractiveModeId = 'apply' | 'follow-up';

export const STATUS_KEBAB_ACTIONS: Record<string, InteractiveModeId[]> = {
  screened: ['apply'],
  evaluated: ['apply'],
  applied: ['follow-up'],
  responded: ['follow-up'],
  interview: ['follow-up'],
  offer: ['follow-up'],
  rejected: [],
  discarded: [],
};

export function interactiveModesForStatus(status: string): InteractiveModeId[] {
  return STATUS_KEBAB_ACTIONS[(status || '').toLowerCase()] ?? [];
}

export function interactiveModesFor(r: ReportR): InteractiveModeId[] {
  const status = r.status || (r.state === 'evaluated' ? 'evaluated' : 'screened');
  return interactiveModesForStatus(status);
}
