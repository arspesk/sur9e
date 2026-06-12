// Unit tests for schedule preset helpers.
// Round-trips: hourly, daily, weekdays, weekends, weekly, monthly, custom.
// Legacy "every-6h"/"every-12h" crons now map to custom (migration note).

import { describe, expect, it } from 'vitest';
import { cronToPreset, presetToCron } from '../sections/schedule-presets';

describe('cronToPreset', () => {
  // ── Hourly ────────────────────────────────────────────────────────────────
  it('recognises hourly', () => {
    const { preset, time } = cronToPreset('0 * * * *');
    expect(preset).toBe('hourly');
    expect(time).toBe('09:00'); // time not meaningful for hourly
  });

  // ── Daily ─────────────────────────────────────────────────────────────────
  it('recognises daily at 09:00', () => {
    const { preset, time } = cronToPreset('0 9 * * *');
    expect(preset).toBe('daily');
    expect(time).toBe('09:00');
  });

  it('recognises daily at 14:30', () => {
    const { preset, time } = cronToPreset('30 14 * * *');
    expect(preset).toBe('daily');
    expect(time).toBe('14:30');
  });

  // ── Weekdays ──────────────────────────────────────────────────────────────
  it('recognises weekdays at 08:30', () => {
    const { preset, time } = cronToPreset('30 8 * * 1-5');
    expect(preset).toBe('weekdays');
    expect(time).toBe('08:30');
  });

  // ── Weekends ──────────────────────────────────────────────────────────────
  it('recognises weekends at 10:00 (0,6 order)', () => {
    const { preset, time } = cronToPreset('0 10 * * 0,6');
    expect(preset).toBe('weekends');
    expect(time).toBe('10:00');
  });

  it('recognises weekends at 10:00 (6,0 order)', () => {
    const { preset, time } = cronToPreset('0 10 * * 6,0');
    expect(preset).toBe('weekends');
    expect(time).toBe('10:00');
  });

  // ── Weekly ────────────────────────────────────────────────────────────────
  it('recognises weekly on Wednesday at 09:00', () => {
    const { preset, time, dow } = cronToPreset('0 9 * * 3');
    expect(preset).toBe('weekly');
    expect(time).toBe('09:00');
    expect(dow).toBe(3);
  });

  it('recognises weekly on Sunday (0) at 07:15', () => {
    const { preset, time, dow } = cronToPreset('15 7 * * 0');
    expect(preset).toBe('weekly');
    expect(time).toBe('07:15');
    expect(dow).toBe(0);
  });

  // ── Monthly ───────────────────────────────────────────────────────────────
  it('recognises monthly on the 15th at 08:30', () => {
    const { preset, time, dom } = cronToPreset('30 8 15 * *');
    expect(preset).toBe('monthly');
    expect(time).toBe('08:30');
    expect(dom).toBe(15);
  });

  it('recognises monthly on the 1st at 09:00', () => {
    const { preset, time, dom } = cronToPreset('0 9 1 * *');
    expect(preset).toBe('monthly');
    expect(time).toBe('09:00');
    expect(dom).toBe(1);
  });

  // ── Custom / fallback ─────────────────────────────────────────────────────
  it('falls back to custom for unrecognised expressions', () => {
    const { preset } = cronToPreset('0 */3 * * *');
    expect(preset).toBe('custom');
  });

  it('falls back to custom for an empty string', () => {
    const { preset } = cronToPreset('');
    expect(preset).toBe('custom');
  });

  // Legacy every-6h / every-12h → custom (migration note in schedule-presets.ts)
  it('legacy 0 */6 * * * maps to custom (no longer a named preset)', () => {
    const { preset } = cronToPreset('0 */6 * * *');
    expect(preset).toBe('custom');
  });

  it('legacy 0 */12 * * * maps to custom (no longer a named preset)', () => {
    const { preset } = cronToPreset('0 */12 * * *');
    expect(preset).toBe('custom');
  });

  // ── Precedence checks ─────────────────────────────────────────────────────
  // "0 9 * * *" must be daily, NOT monthly (dom=* is a wildcard, not a number)
  it('0 9 * * * is daily, not monthly (precedence)', () => {
    const { preset } = cronToPreset('0 9 * * *');
    expect(preset).toBe('daily');
  });

  // "0 9 1 * *" has numeric dom=1, so it IS monthly
  it('0 9 1 * * is monthly, not daily (precedence)', () => {
    const { preset } = cronToPreset('0 9 1 * *');
    expect(preset).toBe('monthly');
  });
});

describe('presetToCron', () => {
  it('hourly round-trip', () => {
    expect(presetToCron('hourly')).toBe('0 * * * *');
  });

  it('daily at 09:00 round-trip', () => {
    expect(presetToCron('daily', '09:00')).toBe('0 9 * * *');
  });

  it('weekdays at 08:30 round-trip', () => {
    expect(presetToCron('weekdays', '08:30')).toBe('30 8 * * 1-5');
  });

  it('weekends at 10:00 round-trip', () => {
    expect(presetToCron('weekends', '10:00')).toBe('0 10 * * 0,6');
  });

  it('weekly Wednesday 09:00 round-trip', () => {
    expect(presetToCron('weekly', '09:00', 3)).toBe('0 9 * * 3');
  });

  it('monthly 15th 08:30 round-trip', () => {
    expect(presetToCron('monthly', '08:30', 1, 15)).toBe('30 8 15 * *');
  });

  it('custom passthrough — presetToCron returns the raw string as-is', () => {
    const raw = '0 */3 * * *';
    expect(presetToCron('custom', raw)).toBe(raw);
  });

  it('invalid time string falls back to 09:00', () => {
    expect(presetToCron('daily', 'bad')).toBe('0 9 * * *');
  });

  it('weekly with out-of-range dow falls back to 1 (Monday)', () => {
    expect(presetToCron('weekly', '09:00', 9)).toBe('0 9 * * 1');
  });

  it('monthly with dom > 28 falls back to 1', () => {
    expect(presetToCron('monthly', '09:00', 1, 31)).toBe('0 9 1 * *');
  });
});

describe('cronToPreset → presetToCron round-trips', () => {
  const cases: Array<[string, string]> = [
    ['0 * * * *', '0 * * * *'], // hourly
    ['0 9 * * *', '0 9 * * *'], // daily
    ['30 8 * * 1-5', '30 8 * * 1-5'], // weekdays
    ['0 10 * * 0,6', '0 10 * * 0,6'], // weekends
    ['0 9 * * 3', '0 9 * * 3'], // weekly Wednesday
    ['30 8 15 * *', '30 8 15 * *'], // monthly 15th
  ];

  for (const [input, expected] of cases) {
    it(`round-trips ${input}`, () => {
      const { preset, time, dow, dom } = cronToPreset(input);
      const out = preset === 'custom' ? input : presetToCron(preset, time, dow ?? 1, dom ?? 1);
      expect(out).toBe(expected);
    });
  }

  it('legacy 0 */6 * * * survives as custom (no data loss)', () => {
    const { preset } = cronToPreset('0 */6 * * *');
    expect(preset).toBe('custom');
    // Round-trip: custom passes through unchanged (caller owns the string)
    const out = presetToCron('custom', '0 */6 * * *');
    expect(out).toBe('0 */6 * * *');
  });
});
