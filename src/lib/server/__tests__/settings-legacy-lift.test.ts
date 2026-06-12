// Old-shape config.yml files must parse into the new shape (appearance/
// providers/system/flattened advanced) with ui.density dropped. Fixtures
// only — never touches real user files.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../settings';

let dir: string;
let cfgPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sur9e-lift-'));
  cfgPath = join(dir, 'config.yml');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const OLD_SHAPE = `
ui:
  theme: dark
  density: compact
screening:
  smoke_test_limit: 5
scanning:
  jobspy:
    hours_old: 72
advanced:
  score_threshold: 4
  screening:
    parallel_workers: 8
    timeout_ms: 90000
  system:
    update_source: https://github.com/someone/fork.git
    update_branch: dev
  default_provider: opencode
  default_model: opencode/deepseek-v4-flash-free
  modes:
    screen: { platform: claude, model: claude-haiku-4-5-20251001 }
`;

describe('legacy shape lift', () => {
  it('lifts a full old-shape file into the new shape', async () => {
    writeFileSync(cfgPath, OLD_SHAPE);
    const s = await loadSettings(cfgPath);
    expect(s.appearance.theme).toBe('dark');
    expect((s.appearance as Record<string, unknown>).density).toBeUndefined();
    expect(s.screening.smoke_test_limit).toBe(5);
    expect(s.scanning.jobspy.hours_old).toBe(72);
    expect(s.advanced.score_threshold).toBe(4);
    expect(s.advanced.parallel_workers).toBe(8);
    expect(s.advanced.timeout_ms).toBe(90000);
    expect(s.system.update_source).toBe('https://github.com/someone/fork.git');
    expect(s.system.update_branch).toBe('dev');
    expect(s.providers.default_provider).toBe('opencode');
    expect(s.providers.modes.screen).toEqual({
      platform: 'claude',
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('parses a new-shape file as-is', async () => {
    writeFileSync(
      cfgPath,
      [
        'appearance:',
        '  theme: light',
        'providers:',
        '  default_provider: claude',
        'system:',
        '  update_branch: main',
        'advanced:',
        '  parallel_workers: 4',
      ].join('\n'),
    );
    const s = await loadSettings(cfgPath);
    expect(s.appearance.theme).toBe('light');
    expect(s.advanced.parallel_workers).toBe(4);
  });

  it('new keys win over old when both present (mixed shape)', async () => {
    writeFileSync(cfgPath, ['ui:', '  theme: dark', 'appearance:', '  theme: light'].join('\n'));
    const s = await loadSettings(cfgPath);
    expect(s.appearance.theme).toBe('light');
  });

  it('missing file returns full defaults in new shape', async () => {
    const s = await loadSettings(join(dir, 'missing.yml'));
    expect(s.appearance.theme).toBe('system');
    expect(s.providers.default_provider).toBe('claude');
    expect(s.system.update_branch).toBe('main');
    expect(s.advanced.parallel_workers).toBe(8);
  });

  it('save migrates the file on disk to the new shape', async () => {
    writeFileSync(cfgPath, OLD_SHAPE);
    await saveSettings(cfgPath, { screening: { smoke_test_limit: 9 } });
    const reloaded = await loadSettings(cfgPath);
    expect(reloaded.screening.smoke_test_limit).toBe(9);
    expect(reloaded.appearance.theme).toBe('dark');
    // Raw file must no longer contain old group keys.
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(cfgPath, 'utf-8');
    expect(raw).not.toMatch(/^ui:/m);
    expect(raw).not.toMatch(/density/);
    expect(raw).toMatch(/^appearance:/m);
    expect(raw).toMatch(/^providers:/m);
  });

  it('legacy advanced.models still migrates into providers.modes', async () => {
    writeFileSync(
      cfgPath,
      ['advanced:', '  models:', '    screen: claude-haiku-4-5-20251001'].join('\n'),
    );
    const s = await loadSettings(cfgPath);
    expect(s.providers.modes.screen).toEqual({
      platform: 'claude',
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('NaN leaves in the partial are dropped, not persisted', async () => {
    writeFileSync(cfgPath, 'advanced:\n  score_threshold: 3.7\n');
    const s = await saveSettings(cfgPath, { advanced: { score_threshold: Number.NaN } });
    expect(s.advanced.score_threshold).toBe(3.7);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(cfgPath, 'utf-8')).not.toMatch(/\.nan|NaN/i);
  });

  it('zero is a valid value and survives the NaN strip', async () => {
    writeFileSync(cfgPath, 'screening:\n  smoke_test_limit: 5\n');
    const s = await saveSettings(cfgPath, { screening: { smoke_test_limit: 0 } });
    expect(s.screening.smoke_test_limit).toBe(0);
  });

  it('an invalid partial never reaches disk (validate-before-write)', async () => {
    writeFileSync(cfgPath, 'advanced:\n  score_threshold: 3.7\n');
    const before = (await import('node:fs')).readFileSync(cfgPath, 'utf-8');
    await expect(
      saveSettings(cfgPath, { advanced: { score_threshold: 'not-a-number' } }),
    ).rejects.toThrow();
    const after = (await import('node:fs')).readFileSync(cfgPath, 'utf-8');
    expect(after).toBe(before);
  });
});

describe('scanning.schedule group', () => {
  it('defaults to disabled with a daily-9am cron', async () => {
    const s = await loadSettings(join(dir, 'missing.yml'));
    expect(s.scanning.schedule.enabled).toBe(false);
    expect(s.scanning.schedule.cron).toBe('0 9 * * *');
    expect(s.scanning.schedule.catch_up_hours).toBe(24);
  });

  it('round-trips a custom schedule', async () => {
    writeFileSync(
      cfgPath,
      ['scanning:', '  schedule:', '    enabled: true', '    cron: "0 */6 * * *"'].join('\n'),
    );
    const s = await loadSettings(cfgPath);
    expect(s.scanning.schedule.enabled).toBe(true);
    expect(s.scanning.schedule.cron).toBe('0 */6 * * *');
  });

  it('rejects an invalid cron expression at the boundary', async () => {
    writeFileSync(cfgPath, ['scanning:', '  schedule:', '    cron: "not a cron"'].join('\n'));
    // loadSettings catches parse errors and returns defaults — the invalid
    // expression must not survive into the typed surface.
    const s = await loadSettings(cfgPath);
    expect(s.scanning.schedule.cron).toBe('0 9 * * *');
  });
});
