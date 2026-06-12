// src/lib/server/__tests__/resolve-mode-runtime.test.ts
//
// Locks in the 5-level resolution waterfall for resolveModeRuntime:
//
//   1. run override      — passed in at call time (launch dialog quick-pick)
//   2. per-mode setting  — providers.modes[modeId] in inputs/config/config.yml
//   3. global default    — providers.default_provider/default_model (user choice)
//   4. mode front-matter — default_platform/default_model on content/modes/<id>.md
//   5. hardcoded fallback — claude + claude-sonnet-4-6
//
// Each test allocates a fresh tmpdir so the module-level config cache (keyed on
// rootPath) does not cross-contaminate; clearProvidersCache() additionally
// resets the cache between tests for belt-and-braces.

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearProvidersCache, resolveModeRuntime } from '../providers/registry';

function fixture(opts: {
  modeFrontMatter?: Record<string, unknown>;
  config?: Record<string, unknown>;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-resolve-'));
  mkdirSync(join(root, 'content/modes'), { recursive: true });
  mkdirSync(join(root, 'inputs/config'), { recursive: true });
  const fm = opts.modeFrontMatter ? `---\n${yaml.dump(opts.modeFrontMatter)}---\n` : '';
  writeFileSync(join(root, 'content/modes/interview-prep.md'), `${fm}Body.`);
  if (opts.config) {
    writeFileSync(join(root, 'inputs/config/config.yml'), yaml.dump(opts.config));
  }
  return root;
}

beforeEach(() => {
  clearProvidersCache();
  // loadModeManifest is memoized via React cache() (per-render), so each new
  // tmpdir gives us a fresh manifest — no explicit clear needed there.
});

describe('resolveModeRuntime — config cache invalidation', () => {
  it('picks up a config.yml edit (new mtime) without an explicit clear', () => {
    // Mirrors the long-lived Next server: the cache is
    // populated once, then the user re-pins a mode on disk. Without mtime
    // awareness the server would keep serving the stale model while spawned
    // job workers (fresh processes) read the new one — the modal-vs-run
    // disagreement this guards against.
    const root = fixture({
      config: { providers: { default_provider: 'claude', default_model: 'claude-sonnet-4-6' } },
    });
    const before = resolveModeRuntime(root, 'interview-prep');
    expect(before.provider).toBe('claude');
    expect(before.model).toBe('claude-sonnet-4-6');

    const cfgPath = join(root, 'inputs/config/config.yml');
    writeFileSync(
      cfgPath,
      yaml.dump({
        providers: {
          default_provider: 'claude',
          default_model: 'claude-sonnet-4-6',
          modes: {
            'interview-prep': { platform: 'opencode', model: 'opencode/deepseek-v4-flash-free' },
          },
        },
      }),
    );
    // Force a strictly-later mtime so the guard fires regardless of the
    // filesystem's mtime granularity (same-ms rewrites would otherwise tie).
    utimesSync(cfgPath, new Date(), new Date(Date.now() + 5_000));

    const after = resolveModeRuntime(root, 'interview-prep');
    expect(after.provider).toBe('opencode');
    expect(after.model).toBe('opencode/deepseek-v4-flash-free');
    expect(after.resolvedFrom).toBe('mode_setting');
  });
});

describe('resolveModeRuntime — waterfall', () => {
  it('level 1: per-run override wins', () => {
    const root = fixture({
      modeFrontMatter: {
        default_platform: 'claude',
        default_model: 'claude-sonnet-4-6',
        exec: 'both',
      },
      config: { advanced: { default_provider: 'claude', default_model: 'claude-sonnet-4-6' } },
    });
    const r = resolveModeRuntime(root, 'interview-prep', {
      platform: 'opencode',
      model: 'anthropic/claude-3-haiku',
    });
    expect(r.provider).toBe('opencode');
    expect(r.model).toBe('anthropic/claude-3-haiku');
    expect(r.resolvedFrom).toBe('run_override');
  });

  it('level 2: per-mode setting beats global + mode defaults', () => {
    const root = fixture({
      modeFrontMatter: {
        default_platform: 'claude',
        default_model: 'claude-sonnet-4-6',
        exec: 'both',
      },
      config: {
        advanced: {
          default_provider: 'claude',
          default_model: 'claude-sonnet-4-6',
          modes: {
            'interview-prep': { platform: 'opencode', model: 'anthropic/claude-3-haiku' },
          },
        },
      },
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.provider).toBe('opencode');
    expect(r.resolvedFrom).toBe('mode_setting');
  });

  it('level 2 (new shape): per-mode override from providers.modes', () => {
    const root = fixture({
      config: {
        providers: {
          modes: {
            'interview-prep': { platform: 'opencode', model: 'opencode/deepseek-v4-flash-free' },
          },
        },
      },
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.provider).toBe('opencode');
    expect(r.model).toBe('opencode/deepseek-v4-flash-free');
    expect(r.resolvedFrom).toBe('mode_setting');
  });

  it('level 2 (old shape fallback): per-mode override from unmigrated advanced.modes', () => {
    const root = fixture({
      config: {
        advanced: {
          modes: { 'interview-prep': { platform: 'claude', model: 'claude-sonnet-4-6' } },
        },
      },
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('claude-sonnet-4-6');
    expect(r.resolvedFrom).toBe('mode_setting');
  });

  it('level 2 precedence: providers.modes wins over advanced.modes when both present', () => {
    const root = fixture({
      config: {
        providers: {
          modes: {
            'interview-prep': { platform: 'opencode', model: 'opencode/deepseek-v4-flash-free' },
          },
        },
        advanced: {
          modes: { 'interview-prep': { platform: 'claude', model: 'claude-sonnet-4-6' } },
        },
      },
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.provider).toBe('opencode');
    expect(r.model).toBe('opencode/deepseek-v4-flash-free');
  });

  it('level 3: global default beats mode front-matter (user choice wins)', () => {
    // The user's explicit Settings choice applies to every mode without a
    // per-mode override — front-matter is out-of-box tuning, not a pin.
    const root = fixture({
      modeFrontMatter: { default_platform: 'codex', default_model: 'gpt-5.5', exec: 'both' },
      config: { advanced: { default_provider: 'claude', default_model: 'claude-sonnet-4-6' } },
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('claude-sonnet-4-6');
    expect(r.resolvedFrom).toBe('global_default');
  });

  it('level 4: mode front-matter applies when no global default is set', () => {
    const root = fixture({
      modeFrontMatter: { default_platform: 'codex', default_model: 'gpt-5.5', exec: 'both' },
      config: {},
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.provider).toBe('codex');
    expect(r.model).toBe('gpt-5.5');
    expect(r.resolvedFrom).toBe('mode_default');
  });

  it('reach-out keeps reach-out.md exec even when the global default wins', () => {
    const root = fixture({
      config: { advanced: { default_provider: 'opencode', default_model: 'opencode/big-pickle' } },
    });
    writeFileSync(
      join(root, 'content/modes/reach-out.md'),
      `---\n${yaml.dump({ default_platform: 'claude', default_model: 'claude-sonnet-4-6', exec: 'headless', needs_tools: [] })}---\nBody.`,
    );
    const r = resolveModeRuntime(root, 'reach-out');
    expect(r.provider).toBe('opencode');
    expect(r.model).toBe('opencode/big-pickle');
    expect(r.resolvedFrom).toBe('global_default');
    expect(r.exec).toBe('headless');
  });

  it('reach-out resolves per-mode settings saved under reach-out', () => {
    const root = fixture({
      config: {
        providers: {
          default_provider: 'claude',
          default_model: 'claude-sonnet-4-6',
          modes: {
            'reach-out': { platform: 'opencode', model: 'opencode/deepseek-v4-flash-free' },
          },
        },
      },
    });
    writeFileSync(
      join(root, 'content/modes/reach-out.md'),
      `---\n${yaml.dump({ default_platform: 'claude', default_model: 'claude-sonnet-4-6', exec: 'headless', needs_tools: [] })}---\nBody.`,
    );
    const r = resolveModeRuntime(root, 'reach-out');
    expect(r.provider).toBe('opencode');
    expect(r.model).toBe('opencode/deepseek-v4-flash-free');
    expect(r.resolvedFrom).toBe('mode_setting');
    expect(r.exec).toBe('headless');
  });

  it('reach-out resolves reach-out.md front-matter when no global default', () => {
    const root = fixture({ config: {} });
    writeFileSync(
      join(root, 'content/modes/reach-out.md'),
      `---\n${yaml.dump({ default_platform: 'claude', default_model: 'claude-sonnet-4-6', exec: 'headless', needs_tools: [] })}---\nBody.`,
    );
    const r = resolveModeRuntime(root, 'reach-out');
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('claude-sonnet-4-6');
    expect(r.resolvedFrom).toBe('mode_default');
    expect(r.exec).toBe('headless');
  });

  it('level 3: global default applies when no mode info', () => {
    const root = fixture({
      config: { advanced: { default_provider: 'codex', default_model: 'gpt-5.5' } },
    });
    const r = resolveModeRuntime(root, 'unknown-mode-id');
    expect(r.provider).toBe('codex');
    expect(r.resolvedFrom).toBe('global_default');
  });

  it('level 5: hardcoded fallback when nothing else set', () => {
    const root = fixture({});
    const r = resolveModeRuntime(root, 'unknown-mode-id');
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('claude-sonnet-4-6');
    expect(r.resolvedFrom).toBe('fallback');
  });

  it('falls back to legacy advanced.models.<id> when no advanced.modes.<id> exists', () => {
    // Legacy configs used `advanced.models.<id>: <model>` (scalar shape).
    // The settings.ts migration only rewrites `screen` + `batch-evaluate`
    // on disk; the 6 other modes need in-memory synthesis in registry.ts so
    // the job-spawn path (which bypasses loadSettings) doesn't silently
    // downgrade to the hardcoded fallback.
    const root = fixture({
      config: {
        advanced: {
          models: { evaluate: 'claude-haiku-4-5-20251001' }, // legacy key
        },
      },
    });
    const r = resolveModeRuntime(root, 'evaluate');
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('claude-haiku-4-5-20251001');
    expect(r.resolvedFrom).toBe('mode_setting'); // synthesized as a per-mode override
  });

  it('rejects malicious model strings via ProviderModelRef.parse', () => {
    // The Claude adapter interpolates `model` into `--model ${model}` inside a
    // bash -c command, so a shell-injection model id from a hand-edited
    // config.yml must throw at resolve time rather than reach spawn. The
    // runner wraps buildCommand in try/catch and persists the throw as the
    // job's error — so failing fast here is the right behavior.
    const root = fixture({
      config: {
        advanced: {
          modes: { evaluate: { platform: 'claude', model: 'claude-sonnet; rm -rf /' } },
        },
      },
    });
    expect(() => resolveModeRuntime(root, 'evaluate')).toThrow();
  });
});

describe('resolveModeRuntime — fallback', () => {
  it('per-mode fallback wins over global fallback', () => {
    const root = fixture({
      config: {
        providers: {
          modes: {
            'interview-prep': { platform: 'claude', model: 'claude-sonnet-4-6' },
          },
          fallback: { platform: 'opencode', model: 'opencode/global-fb' },
        },
      },
    });
    // Per-mode fallback on the mode row takes precedence over the global one.
    const root2 = fixture({
      config: {
        providers: {
          modes: {
            'interview-prep': {
              platform: 'claude',
              model: 'claude-sonnet-4-6',
              fallback: { platform: 'codex', model: 'gpt-5.5' },
            },
          },
          fallback: { platform: 'opencode', model: 'opencode/global-fb' },
        },
      },
    });
    void root;
    const r = resolveModeRuntime(root2, 'interview-prep');
    expect(r.fallback).toEqual({ provider: 'codex', model: 'gpt-5.5' });
  });

  it('reach-out resolves per-mode fallback saved under reach-out', () => {
    const root = fixture({
      config: {
        providers: {
          modes: {
            'reach-out': {
              platform: 'opencode',
              model: 'opencode/deepseek-v4-flash-free',
              fallback: { platform: 'codex', model: 'gpt-5.5' },
            },
          },
          fallback: { platform: 'claude', model: 'claude-sonnet-4-6' },
        },
      },
    });
    writeFileSync(join(root, 'content/modes/reach-out.md'), 'Body.');
    const r = resolveModeRuntime(root, 'reach-out');
    expect(r.provider).toBe('opencode');
    expect(r.model).toBe('opencode/deepseek-v4-flash-free');
    expect(r.fallback).toEqual({ provider: 'codex', model: 'gpt-5.5' });
  });

  it('global fallback applies when the mode has none', () => {
    const root = fixture({
      config: {
        providers: {
          modes: {
            'interview-prep': { platform: 'claude', model: 'claude-sonnet-4-6' },
          },
          fallback: { platform: 'opencode', model: 'opencode/global-fb' },
        },
      },
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.fallback).toEqual({ provider: 'opencode', model: 'opencode/global-fb' });
  });

  it('no fallback configured → undefined', () => {
    const root = fixture({
      config: {
        providers: {
          modes: {
            'interview-prep': { platform: 'claude', model: 'claude-sonnet-4-6' },
          },
        },
      },
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.fallback).toBeUndefined();
  });

  it('fallback identical to the resolved primary is dropped', () => {
    const root = fixture({
      config: {
        providers: {
          modes: {
            'interview-prep': { platform: 'claude', model: 'claude-sonnet-4-6' },
          },
          fallback: { platform: 'claude', model: 'claude-sonnet-4-6' },
        },
      },
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.fallback).toBeUndefined();
  });

  it('fallback still resolves under a run override', () => {
    const root = fixture({
      config: {
        providers: {
          fallback: { platform: 'opencode', model: 'opencode/global-fb' },
        },
      },
    });
    const r = resolveModeRuntime(root, 'interview-prep', {
      platform: 'claude',
      model: 'claude-sonnet-4-6',
    });
    expect(r.resolvedFrom).toBe('run_override');
    expect(r.fallback).toEqual({ provider: 'opencode', model: 'opencode/global-fb' });
  });

  it('malformed fallback (platform only, no model) is ignored', () => {
    const root = fixture({
      config: {
        providers: {
          modes: {
            'interview-prep': { platform: 'opencode', model: 'opencode/primary' },
          },
          fallback: { platform: 'claude' },
        },
      },
    });
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.fallback).toBeUndefined();
    expect(r.provider).toBe('opencode');
    expect(r.model).toBe('opencode/primary');
    expect(r.resolvedFrom).toBe('mode_setting');
  });

  it('hand-written raw-YAML config with fallback keys resolves correctly', () => {
    const root = mkdtempSync(join(tmpdir(), 'sur9e-resolve-'));
    mkdirSync(join(root, 'content/modes'), { recursive: true });
    mkdirSync(join(root, 'inputs/config'), { recursive: true });
    writeFileSync(join(root, 'content/modes/interview-prep.md'), 'Body.');
    writeFileSync(
      join(root, 'inputs/config/config.yml'),
      [
        'providers:',
        '  modes:',
        '    interview-prep:',
        '      platform: claude',
        '      model: claude-sonnet-4-6',
        '  fallback:',
        '    platform: opencode',
        '    model: opencode/global-fb',
        '',
      ].join('\n'),
    );
    const r = resolveModeRuntime(root, 'interview-prep');
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('claude-sonnet-4-6');
    expect(r.fallback).toEqual({ provider: 'opencode', model: 'opencode/global-fb' });
  });
});
