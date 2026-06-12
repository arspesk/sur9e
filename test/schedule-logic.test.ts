// Pure due-window math — injectable clock, no fs, no jobs API.
//
// TZ-robustness note: cron-parser interprets cron expressions in the system
// local timezone (user intent: "daily 9am" means 9am local, not 9am UTC).
// Rather than hardcoding UTC ISO strings that only pass when TZ=UTC, we
// derive all expected window times via cron-parser itself so assertions stay
// consistent regardless of the machine's local timezone.
import { CronExpressionParser } from 'cron-parser';
import { describe, expect, it } from 'vitest';
import { computeDecision, type ScheduleState } from '@/lib/server/jobs/schedule-logic';

const DAILY_9 = '0 9 * * *';
const EVERY_6H = '0 */6 * * *';
const MONDAYS_9 = '0 9 * * 1';

/** Return the most recent cron window at-or-before `now` (system TZ). */
function prevWindow(cron: string, now: Date): Date {
  return CronExpressionParser.parse(cron, { currentDate: now }).prev().toDate();
}

/** Return the window before `ref` (one interval back). */
function windowBefore(cron: string, ref: Date): Date {
  return CronExpressionParser.parse(cron, {
    currentDate: new Date(ref.getTime() - 1),
  })
    .prev()
    .toDate();
}

function state(partial: Partial<ScheduleState> = {}): ScheduleState {
  return { last_planned: null, last_run: null, last_result: null, cron: null, ...partial };
}

describe('computeDecision', () => {
  it('disabled → never due', () => {
    // Use an arbitrary 'now' — disabled check fires before any window math
    const now = new Date('2026-06-05T20:00:00Z');
    const d = computeDecision({
      enabled: false,
      cron: DAILY_9,
      catchUpHours: 24,
      state: state(),
      now,
    });
    expect(d.action).toBe('idle');
  });

  it('window passed since last_planned → run, planned = the window time', () => {
    // now = 30s after a known '9am local' tick
    // Use 20:00 UTC as a stable 'now' that's well past any morning window
    const now = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, now); // most recent 9am local before now
    const Wprev = windowBefore(DAILY_9, W0); // the window before that

    const d = computeDecision({
      enabled: true,
      cron: DAILY_9,
      catchUpHours: 24,
      state: state({ last_planned: Wprev.toISOString(), cron: DAILY_9 }),
      now,
    });
    expect(d.action).toBe('run');
    if (d.action === 'run') {
      expect(d.planned).toBe(W0.toISOString());
    }
  });

  it('no window passed yet → idle', () => {
    // last_planned = most recent window; no newer window exists before 'now'
    const now = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, now);

    const d = computeDecision({
      enabled: true,
      cron: DAILY_9,
      catchUpHours: 24,
      state: state({ last_planned: W0.toISOString(), cron: DAILY_9 }),
      now,
    });
    expect(d.action).toBe('idle');
  });

  it('multiple missed windows collapse to ONE run at the latest window', () => {
    // Set last_planned to W-3 (three 6h intervals ago)
    // now = well within catch_up_hours (24h grace)
    const now = new Date('2026-06-05T20:00:00Z'); // stable
    const W0 = prevWindow(EVERY_6H, now);
    const W1 = windowBefore(EVERY_6H, W0);
    const W2 = windowBefore(EVERY_6H, W1);
    const W3 = windowBefore(EVERY_6H, W2);

    const d = computeDecision({
      enabled: true,
      cron: EVERY_6H,
      catchUpHours: 24,
      state: state({ last_planned: W3.toISOString(), cron: EVERY_6H }),
      now,
    });
    expect(d.action).toBe('run');
    // The decision collapses to the single latest window (W0)
    if (d.action === 'run') {
      expect(d.planned).toBe(W0.toISOString());
    }
  });

  it('miss older than catch_up_hours → forfeit (state advances, no run)', () => {
    // Scenario 1: 9h-old miss is WITHIN 24h grace → still runs
    // Use now such that W0 is exactly ~9h ago
    const now1 = new Date('2026-06-05T20:00:00Z');
    const W0_daily = prevWindow(DAILY_9, now1);
    const missAge1 = (now1.getTime() - W0_daily.getTime()) / 3_600_000;
    // W0_daily should be < 24h ago for this test to work as intended
    expect(missAge1).toBeLessThan(24);

    const Wprev_daily = windowBefore(DAILY_9, W0_daily);
    const d = computeDecision({
      enabled: true,
      cron: DAILY_9,
      catchUpHours: 24,
      state: state({ last_planned: Wprev_daily.toISOString(), cron: DAILY_9 }),
      now: now1,
    });
    expect(d.action).toBe('run');

    // Scenario 2: Monday 9am window, now is Wednesday; miss is ~48h old → forfeit
    // Use now = Wednesday around mid-morning (local)
    // last Monday 9am local was ~48h+ ago
    // Construct: find a Monday window, then advance now by >24h
    const arbitraryMonday = new Date('2026-06-02T20:00:00Z'); // Tuesday in UTC, Monday evening LA
    const lastMonday = prevWindow(MONDAYS_9, arbitraryMonday);
    // now = lastMonday + 49h (well outside 24h grace)
    const now2 = new Date(lastMonday.getTime() + 49 * 3_600_000);

    const d2 = computeDecision({
      enabled: true,
      cron: MONDAYS_9,
      catchUpHours: 24,
      state: state({
        last_planned: windowBefore(MONDAYS_9, lastMonday).toISOString(),
        cron: MONDAYS_9,
      }),
      now: now2,
    });
    expect(d2.action).toBe('forfeit');
    // State advances to the latest window (lastMonday)
    if (d2.action === 'forfeit') {
      const expectedWindow = prevWindow(MONDAYS_9, now2);
      expect(d2.planned).toBe(expectedWindow.toISOString());
    }
  });

  it('catch_up_hours = 0 → within tick-latency floor (30s) → run; well past floor (2h) → forfeit', () => {
    // Scenario 1: now = 30s after the window (within the 2-min tick-latency floor) → run
    // Build a 'now' that is exactly 30s after a known DAILY_9 window.
    // Use a base time that's well past any morning tick, find the prev window, add 30s.
    const base = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, base);
    const Wprev = windowBefore(DAILY_9, W0);
    const now30s = new Date(W0.getTime() + 30_000); // 30s after the window

    const d = computeDecision({
      enabled: true,
      cron: DAILY_9,
      catchUpHours: 0,
      state: state({ last_planned: Wprev.toISOString(), cron: DAILY_9 }),
      now: now30s,
    });
    // 30s miss is within the 2-minute tick-latency floor → run
    expect(d.action).toBe('run');

    // Scenario 2: now = 2h after the window (well outside floor and catch_up_hours=0) → forfeit
    const now2h = new Date(W0.getTime() + 2 * 3_600_000);
    const d2 = computeDecision({
      enabled: true,
      cron: DAILY_9,
      catchUpHours: 0,
      state: state({ last_planned: Wprev.toISOString(), cron: DAILY_9 }),
      now: now2h,
    });
    // 2h miss is outside both catch_up_hours=0 and the 2-min floor → forfeit
    expect(d2.action).toBe('forfeit');
  });

  it('null last_planned (fresh/corrupt state) → seed, no run', () => {
    const now = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, now);

    const d = computeDecision({
      enabled: true,
      cron: DAILY_9,
      catchUpHours: 24,
      state: state(),
      now,
    });
    expect(d.action).toBe('seed');
    // Seeds to the most recent window so the NEXT window is the first run
    if (d.action === 'seed') {
      expect(d.planned).toBe(W0.toISOString());
    }
  });

  it('last_planned in the future (clock jump) → seed to current window, no run', () => {
    const now = new Date('2026-06-05T20:00:00Z');
    // last_planned far in the future → treated as clock jump
    const d = computeDecision({
      enabled: true,
      cron: DAILY_9,
      catchUpHours: 24,
      state: state({ last_planned: '2027-01-01T09:00:00.000Z', cron: DAILY_9 }),
      now,
    });
    // Clock jump: last_planned > now → seed to current window
    expect(d.action).toBe('seed');
  });

  it('cron expression changed → seed to new window, NEVER a retroactive catch-up run', () => {
    // Regression (2026-06-06): saving a new cron in Settings fired an
    // immediate scan. last_planned was fully up to date under the OLD cron,
    // but the NEW expression's most recent window postdated it and fell
    // within catch_up_hours → treated as a "missed window" → run. Editing
    // the schedule must re-seed instead: the next window is the first run.
    const now = new Date('2026-06-05T20:00:00Z');
    const oldPlanned = prevWindow(MONDAYS_9, now); // up to date under old cron

    const d = computeDecision({
      enabled: true,
      cron: DAILY_9, // user just saved a different expression
      catchUpHours: 24,
      state: state({ last_planned: oldPlanned.toISOString(), cron: MONDAYS_9 }),
      now,
    });
    expect(d.action).toBe('seed');
    if (d.action === 'seed') {
      expect(d.planned).toBe(prevWindow(DAILY_9, now).toISOString());
    }
  });

  it('legacy state without cron stamp → one benign re-seed (upgrade path)', () => {
    const now = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, now);
    const Wprev = windowBefore(DAILY_9, W0);

    const d = computeDecision({
      enabled: true,
      cron: DAILY_9,
      catchUpHours: 24,
      state: state({ last_planned: Wprev.toISOString() }), // cron: null (legacy)
      now,
    });
    expect(d.action).toBe('seed');
  });

  it('invalid cron → idle (never throws)', () => {
    const now = new Date('2026-06-05T20:00:00Z');
    const d = computeDecision({
      enabled: true,
      cron: 'garbage',
      catchUpHours: 24,
      state: state({ last_planned: windowBefore(DAILY_9, now).toISOString() }),
      now,
    });
    expect(d.action).toBe('idle');
  });
});
