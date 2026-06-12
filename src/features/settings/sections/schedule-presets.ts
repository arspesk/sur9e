// schedule-presets.ts — pure helpers for the Scheduled scans sub-block.
// Maps between human-readable preset labels and cron expressions.
// No React, no side-effects — fully unit-testable.
//
// Presets (2026-06-05 vocabulary, replaces Every-6h/12h):
//   "hourly"    → "0 * * * *"
//   "daily"     → "M H * * *"        (time input)
//   "weekdays"  → "M H * * 1-5"      (time input)
//   "weekends"  → "M H * * 0,6"      (time input)
//   "weekly"    → "M H * * <dow>"    (day-of-week 0-6 + time)
//   "monthly"   → "M H <dom> * *"    (day-of-month 1-28 + time; dom capped at 28,
//                                     29-31 would skip short months — user note shown in UI)
//   "custom"    → raw cron passthrough
//
// Migration note: stored "0 */6 * * *" (old every-6h preset) and "0 */12 * * *"
// (old every-12h preset) no longer match any named shape, so cronToPreset maps
// them to "custom" with the raw cron preserved. Nothing breaks — the user just
// sees their cron in the Custom field.

export type SchedulePreset =
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'monthly'
  | 'custom';

export const PRESET_LABELS: Record<SchedulePreset, string> = {
  hourly: 'Hourly',
  daily: 'Daily at…',
  weekdays: 'Weekdays at…',
  weekends: 'Weekends at…',
  weekly: 'Weekly on … at…',
  monthly: 'Monthly on day … at…',
  custom: 'Custom (cron)',
};

/** Parse a cron expression back to the closest preset.
 *  Returns `{ preset, time, dow, dom }` — extra fields are `undefined` when
 *  not relevant to the matched preset.
 *
 *  Reverse-map precedence (most-specific first):
 *    1. Exact `0 * * * *`              → hourly
 *    2. `M H * * 1-5`                  → weekdays
 *    3. `M H * * 0,6` or `M H * * 6,0`→ weekends
 *    4. `M H * * <single 0-6 digit>`   → weekly (extracts dow)
 *    5. `M H <dom 1-28> * *`           → monthly (extracts dom)
 *    6. `M H * * *`                    → daily
 *    7. everything else                → custom
 *
 *  Falls back to "custom" when the expression doesn't match any known shape. */
export function cronToPreset(cron: string): {
  preset: SchedulePreset;
  time: string;
  dow?: number;
  dom?: number;
} {
  const normalized = cron.trim();

  // 1. Hourly
  if (normalized === '0 * * * *') return { preset: 'hourly', time: '09:00' };

  // Shared helper to parse MM:HH from two capture groups.
  const buildTime = (rawMin: string, rawHour: string): string => {
    const h = Number(rawHour).toString().padStart(2, '0');
    const m = Number(rawMin).toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  // 2. Weekdays: "M H * * 1-5"
  const weekdayMatch = /^(\d+)\s+(\d+)\s+\*\s+\*\s+1-5$/.exec(normalized);
  if (weekdayMatch) {
    return { preset: 'weekdays', time: buildTime(weekdayMatch[1]!, weekdayMatch[2]!) };
  }

  // 3. Weekends: "M H * * 0,6" or "M H * * 6,0"
  const weekendMatch = /^(\d+)\s+(\d+)\s+\*\s+\*\s+(?:0,6|6,0)$/.exec(normalized);
  if (weekendMatch) {
    return { preset: 'weekends', time: buildTime(weekendMatch[1]!, weekendMatch[2]!) };
  }

  // 4. Weekly: "M H * * <single digit 0-6>"
  const weeklyMatch = /^(\d+)\s+(\d+)\s+\*\s+\*\s+([0-6])$/.exec(normalized);
  if (weeklyMatch) {
    return {
      preset: 'weekly',
      time: buildTime(weeklyMatch[1]!, weeklyMatch[2]!),
      dow: Number(weeklyMatch[3]),
    };
  }

  // 5. Monthly: "M H <dom 1-28> * *"  (numeric dom, no wildcards)
  const monthlyMatch = /^(\d+)\s+(\d+)\s+(\d+)\s+\*\s+\*$/.exec(normalized);
  if (monthlyMatch) {
    const dom = Number(monthlyMatch[3]);
    if (dom >= 1 && dom <= 28) {
      return { preset: 'monthly', time: buildTime(monthlyMatch[1]!, monthlyMatch[2]!), dom };
    }
  }

  // 6. Daily: "M H * * *"
  const dailyMatch = /^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/.exec(normalized);
  if (dailyMatch) {
    return { preset: 'daily', time: buildTime(dailyMatch[1]!, dailyMatch[2]!) };
  }

  // 7. Custom / unrecognised
  return { preset: 'custom', time: '09:00' };
}

/** Build a cron expression from a preset + optional time/dow/dom.
 *
 *  @param preset   - one of the SchedulePreset values
 *  @param time     - HH:MM string (used by daily/weekdays/weekends/weekly/monthly);
 *                    falls back to "09:00" on invalid input
 *  @param dow      - day of week 0-6 (0=Sunday); used only by "weekly"
 *  @param dom      - day of month 1-28; used only by "monthly"
 *
 *  For "custom" the caller passes the raw cron expression as `time`;
 *  presetToCron returns it unchanged so the field is never empty on switch.
 */
export function presetToCron(preset: SchedulePreset, time = '09:00', dow = 1, dom = 1): string {
  if (preset === 'hourly') return '0 * * * *';

  // Parse the time string (HH:MM); fall back to 09:00 on invalid input.
  const [hRaw, mRaw] = time.split(':');
  const h = Number(hRaw ?? '9');
  const m = Number(mRaw ?? '0');
  const hour = Number.isFinite(h) && h >= 0 && h <= 23 ? h : 9;
  const min = Number.isFinite(m) && m >= 0 && m <= 59 ? m : 0;

  if (preset === 'daily') return `${min} ${hour} * * *`;
  if (preset === 'weekdays') return `${min} ${hour} * * 1-5`;
  if (preset === 'weekends') return `${min} ${hour} * * 0,6`;

  if (preset === 'weekly') {
    const d = Number.isFinite(dow) && dow >= 0 && dow <= 6 ? dow : 1;
    return `${min} ${hour} * * ${d}`;
  }

  if (preset === 'monthly') {
    const day = Number.isFinite(dom) && dom >= 1 && dom <= 28 ? dom : 1;
    return `${min} ${hour} ${day} * *`;
  }

  // 'custom' — caller owns the raw cron string; presetToCron returns a
  // sensible default so the field is never empty on initial switch to Custom.
  return time; // for 'custom' the caller passes the raw cron directly
}
