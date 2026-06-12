// Scheduler runtime — drive one tick with injected deps (no real timers, no
// real jobs API, no real cron interval). Tests verify file I/O, state
// transitions, and singleton conflict handling.
//
// TZ-robustness: cron windows are local-time. Expected window strings are
// derived via cron-parser (same as the scheduler) so assertions stay correct
// regardless of the machine's local timezone.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSchedulerTick } from '@/lib/server/jobs/scheduler';

/** Most recent cron window at-or-before `now` (system TZ). */
function prevWindow(cron: string, now: Date): Date {
  return CronExpressionParser.parse(cron, { currentDate: now }).prev().toDate();
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sur9e-sched-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'inputs/config'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const DAILY_9 = '0 9 * * *';

function enableSchedule(cron = DAILY_9) {
  writeFileSync(
    join(root, 'inputs/config/config.yml'),
    ['scanning:', '  schedule:', '    enabled: true', `    cron: "${cron}"`].join('\n'),
  );
}

function seedState(lastPlanned: string, cron = DAILY_9) {
  writeFileSync(
    join(root, 'data/schedule-state.json'),
    JSON.stringify({ last_planned: lastPlanned, last_run: null, last_result: null, cron }),
  );
}

describe('runSchedulerTick', () => {
  it('spawns a scan when a window is due and records state', async () => {
    enableSchedule();
    // Use a 'now' well past a cron window; seed last_planned to the window
    // before that so the scheduler sees exactly one missed window.
    const now = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, now); // most recent 9am local before now
    // One interval back — the window we already "handled"
    const Wprev = prevWindow(DAILY_9, new Date(W0.getTime() - 1));

    seedState(Wprev.toISOString());

    const spawn = vi.fn().mockResolvedValue({ id: 'job-1' });
    const findActive = vi.fn().mockReturnValue(null);
    await runSchedulerTick(root, { now, spawn, findActive });

    expect(spawn).toHaveBeenCalledWith('scan', { scheduled: true });
    const st = JSON.parse(readFileSync(join(root, 'data/schedule-state.json'), 'utf-8'));
    expect(st.last_planned).toBe(W0.toISOString());
    expect(st.last_result).toBe('started');
  });

  it('records skipped + does NOT advance last_planned on singleton conflict', async () => {
    enableSchedule();
    const now = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, now);
    const Wprev = prevWindow(DAILY_9, new Date(W0.getTime() - 1));

    seedState(Wprev.toISOString());

    const spawn = vi.fn();
    const findActive = vi.fn().mockReturnValue({ id: 'busy' });
    await runSchedulerTick(root, { now, spawn, findActive });

    expect(spawn).not.toHaveBeenCalled();
    const st = JSON.parse(readFileSync(join(root, 'data/schedule-state.json'), 'utf-8'));
    // last_planned must NOT advance — next tick will retry the same window
    expect(st.last_planned).toBe(Wprev.toISOString());
    expect(st.last_result).toBe('skipped');
  });

  it('disabled schedule → no spawn, no state write', async () => {
    // No config file written → loadSettings returns defaults (enabled: false)
    const spawn = vi.fn();
    await runSchedulerTick(root, {
      now: new Date('2026-06-05T20:00:00Z'),
      spawn,
      findActive: vi.fn().mockReturnValue(null),
    });
    expect(spawn).not.toHaveBeenCalled();
    // State file must not exist (no write)
    expect(() => readFileSync(join(root, 'data/schedule-state.json'), 'utf-8')).toThrow();
  });

  it('fresh state seeds without spawning', async () => {
    enableSchedule();
    // No state file → readState returns { last_planned: null, ... } → seed action
    const now = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, now);

    const spawn = vi.fn();
    await runSchedulerTick(root, {
      now,
      spawn,
      findActive: vi.fn().mockReturnValue(null),
    });

    expect(spawn).not.toHaveBeenCalled();
    const st = JSON.parse(readFileSync(join(root, 'data/schedule-state.json'), 'utf-8'));
    // Seeds to the most recent window so the NEXT window is the first real run
    expect(st.last_planned).toBe(W0.toISOString());
  });

  it('cron changed in settings → re-seeds with the new cron, NO spawn', async () => {
    // Regression (2026-06-06): editing the cron in Settings fired an
    // immediate scan on the next tick — the new expression's most recent
    // window postdated last_planned and fell inside catch_up_hours.
    const MONDAYS_9 = '0 9 * * 1';
    const now = new Date('2026-06-05T20:00:00Z');
    enableSchedule(DAILY_9); // user just switched MONDAYS_9 → DAILY_9
    seedState(prevWindow(MONDAYS_9, now).toISOString(), MONDAYS_9);

    const spawn = vi.fn();
    await runSchedulerTick(root, { now, spawn, findActive: vi.fn().mockReturnValue(null) });

    expect(spawn).not.toHaveBeenCalled();
    const st = JSON.parse(readFileSync(join(root, 'data/schedule-state.json'), 'utf-8'));
    expect(st.cron).toBe(DAILY_9); // stamped — next tick proceeds normally
    expect(st.last_planned).toBe(prevWindow(DAILY_9, now).toISOString());
  });

  it('run stamps the cron into state', async () => {
    enableSchedule();
    const now = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, now);
    seedState(prevWindow(DAILY_9, new Date(W0.getTime() - 1)).toISOString());

    await runSchedulerTick(root, {
      now,
      spawn: vi.fn().mockResolvedValue({ id: 'job-1' }),
      findActive: vi.fn().mockReturnValue(null),
    });
    const st = JSON.parse(readFileSync(join(root, 'data/schedule-state.json'), 'utf-8'));
    expect(st.cron).toBe(DAILY_9);
  });

  it('spawn failure → marks error, does NOT advance last_planned', async () => {
    enableSchedule();
    const now = new Date('2026-06-05T20:00:00Z');
    const W0 = prevWindow(DAILY_9, now);
    const Wprev = prevWindow(DAILY_9, new Date(W0.getTime() - 1));
    seedState(Wprev.toISOString());
    const spawn = vi.fn().mockRejectedValue(new Error('disk full'));
    await runSchedulerTick(root, { now, spawn, findActive: vi.fn().mockReturnValue(null) });
    const st = JSON.parse(readFileSync(join(root, 'data/schedule-state.json'), 'utf-8'));
    expect(st.last_planned).toBe(Wprev.toISOString());
    expect(st.last_result).toBe('error');
  });
});
