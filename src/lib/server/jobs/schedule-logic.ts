// Pure due-window math for the scan scheduler. No fs, no jobs API, no
// wall clock — `now` is injected so every branch is unit-testable.
//
// Timezone: cron expressions are interpreted in the system local timezone
// (user intent: "0 9 * * *" means 9am where the server runs, not 9am UTC).
// The tz option is intentionally NOT set to UTC so the user's schedule
// matches their wall-clock expectations.
import { CronExpressionParser } from 'cron-parser';

export interface ScheduleState {
  last_planned: string | null; // ISO of the last window we accounted for
  last_run: string | null; // ISO of the last spawned run
  /** 'started' = createJob was called and the record was written to data/jobs/;
   *  the scan itself runs asynchronously — the job deck shows completion. */
  last_result: 'started' | 'error' | 'skipped' | null;
  /** Cron expression `last_planned` was computed under. A mismatch with the
   *  current settings cron means the schedule definition changed — the new
   *  expression's past windows were never scheduled, so they must re-seed,
   *  never fire a retroactive catch-up run. null = legacy state file
   *  (pre-stamp): treated as a mismatch → one benign re-seed on upgrade. */
  cron: string | null;
}

export interface DecisionInput {
  enabled: boolean;
  cron: string;
  catchUpHours: number;
  state: ScheduleState;
  now: Date;
}

export type Decision =
  | { action: 'idle' }
  | { action: 'seed'; planned: string } // write last_planned, no run
  | { action: 'run'; planned: string } // spawn + write last_planned
  | { action: 'forfeit'; planned: string }; // window too old: advance state only

/** Most recent cron window at-or-before `now`, or null for invalid cron. */
function lastWindow(cron: string, now: Date): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: now }).prev().toDate();
  } catch {
    return null;
  }
}

export function computeDecision(input: DecisionInput): Decision {
  const { enabled, cron, catchUpHours, state, now } = input;
  if (!enabled) return { action: 'idle' };

  const window = lastWindow(cron, now);
  if (!window) return { action: 'idle' }; // invalid cron — schema/UI surface the error

  const planned = window.toISOString();

  // Fresh state or a clock jump (last_planned in the future): seed to the
  // most recent window so the NEXT window is the first real run. Prevents
  // a boot-storm on fresh installs and after re-enabling.
  if (!state.last_planned || new Date(state.last_planned) > now) {
    return { action: 'seed', planned };
  }

  // Schedule definition changed: last_planned was computed under a different
  // cron expression, so the new expression's past windows were never actually
  // scheduled — treating them as "missed" would fire a scan the moment the
  // user saves new cron settings (2026-06-06 incident). Re-seed instead:
  // the next window under the new expression is the first real run. A null
  // state.cron (legacy pre-stamp state file) also lands here — one benign
  // re-seed on upgrade, erring away from surprise runs.
  if (state.cron !== cron) {
    return { action: 'seed', planned };
  }

  // Nothing new since the window we already accounted for.
  if (new Date(state.last_planned) >= window) return { action: 'idle' };

  // A newer window exists. Run it if the miss is within the grace period;
  // multiple missed windows collapse to this single latest one.
  //
  // Tick latency is not a "miss": the 60s tick always trails the window
  // slightly. A 2-minute floor lets normal operation fire regardless of
  // catch_up_hours; the configured grace governs real (server-down) gaps.
  const TICK_LATENCY_FLOOR_HOURS = 2 / 60;
  const missAgeHours = (now.getTime() - window.getTime()) / 3_600_000;
  if (missAgeHours <= Math.max(catchUpHours, TICK_LATENCY_FLOOR_HOURS))
    return { action: 'run', planned };
  return { action: 'forfeit', planned };
}
