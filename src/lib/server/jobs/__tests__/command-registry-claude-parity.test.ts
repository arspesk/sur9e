// src/lib/server/jobs/__tests__/command-registry-claude-parity.test.ts
//
// Lock the post-refactor command shape: every LLM-spawning job's bash script
// must continue to delegate to batch/mode-runner.mjs with the expected
// scaffold pieces (set -o pipefail, the per-mode `node batch/mode-runner.mjs
// <type> --num <n>` invocation, etc.).
//
// Uses .toContain() (not snapshot) so cosmetic differences in surrounding
// scaffold or prompt quoting don't fail. The registry no longer spawns
// providers inline — input loading + provider resolution + spawn all live in
// batch/mode-runner.mjs.
//
// The tmp fixture has no content/modes/ and no inputs/config/config.yml, but
// that no longer matters for the registry shape: provider/model resolution
// happens inside mode-runner, so the registry branch is a thin, provider-
// agnostic delegating script regardless of config.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearProvidersCache } from '../../providers/registry';
import { buildCommand } from '../command-registry';

function makeTmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-cmd-parity-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
  writeFileSync(
    join(root, 'data/applications.md'),
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 42 | 2026-05-24 | Acme | SWE | 4.0/5 | Evaluated | x | [42](artifacts/reports/042-acme-2026-05-24.md) | smoke |',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'artifacts/reports/042-acme-2026-05-24.md'),
    '**URL:** https://example.com/jobs/42\n\nbody\n',
  );
  return root;
}

describe('command-registry Claude parity (lock command shape across the refactor)', () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpRoot();
    // Bust the module-level config cache between fixtures so the previous
    // test's tmp root can't leak its config.yml into this one.
    clearProvidersCache();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('evaluate — routes through mode-runner + merge-tracker re-eval', () => {
    const built = buildCommand('evaluate', { num: 42 }, root);
    expect(built).not.toBeNull();
    expect(built!.cmd).toBe('/bin/bash');
    expect(built!.args[1]).toContain('set -o pipefail');
    expect(built!.args[1]).toContain('node batch/mode-runner.mjs evaluate --num 42');
    expect(built!.args[1]).toContain('node cli/merge-tracker.mjs --re-eval=42');
    // Default (no PDF): tailor-cv step must NOT be present.
    expect(built!.args[1]).not.toContain('tailor-cv');
    expect(built!.args[1]).toContain('[1/3]');
  });

  it('evaluate with generate_pdf=true — chains tailor-cv before merge-tracker', () => {
    const built = buildCommand('evaluate', { num: 42, generate_pdf: true }, root);
    expect(built).not.toBeNull();
    expect(built!.cmd).toBe('/bin/bash');
    expect(built!.args[1]).toContain('set -o pipefail');
    expect(built!.args[1]).toContain('node batch/mode-runner.mjs evaluate --num 42');
    expect(built!.args[1]).toContain('node batch/mode-runner.mjs tailor-cv --num 42');
    expect(built!.args[1]).toContain('node cli/merge-tracker.mjs --re-eval=42');
    // tailor-cv must appear before merge-tracker in the script.
    expect(built!.args[1].indexOf('tailor-cv')).toBeLessThan(
      built!.args[1].indexOf('merge-tracker.mjs --re-eval'),
    );
    expect(built!.args[1]).toContain('[1/4]');
    expect(built!.args[1]).toContain('[4/4]');
  });

  it('evaluate — null on a non-integer num', () => {
    expect(buildCommand('evaluate', { num: 'x' as unknown as number }, root)).toBeNull();
  });

  it.each([
    'research',
    'interview-prep',
    'reach-out',
    'negotiate',
  ] as const)('%s — routes through mode-runner', type => {
    const built = buildCommand(type, { num: 42 }, root);
    expect(built).not.toBeNull();
    expect(built!.args[1]).toContain(`node batch/mode-runner.mjs ${type} --num 42`);
    expect(built!.args[1]).toContain('set -o pipefail');
  });

  it('tailor-cv — routes through mode-runner', () => {
    const built = buildCommand('tailor-cv', { num: 42 }, root);
    expect(built).not.toBeNull();
    expect(built!.args[1]).toContain('set -o pipefail');
    expect(built!.args[1]).toContain('node batch/mode-runner.mjs tailor-cv --num 42');
  });

  it('cover-letter — routes through mode-runner', () => {
    const built = buildCommand('cover-letter', { num: 42 }, root);
    expect(built).not.toBeNull();
    expect(built!.args[1]).toContain('set -o pipefail');
    expect(built!.args[1]).toContain('node batch/mode-runner.mjs cover-letter --num 42');
  });

  it('screen-evaluate — routes through screen + mode-runner + merge-tracker', () => {
    const built = buildCommand(
      'screen-evaluate',
      { url: 'https://boards.greenhouse.io/acme/jobs/123' },
      root,
    );
    expect(built).not.toBeNull();
    expect(built!.cmd).toBe('/bin/bash');
    expect(built!.args[1]).toContain('set -o pipefail');
    expect(built!.args[1]).toContain('node batch/mode-runner.mjs evaluate --num "$NUM"');
    expect(built!.args[1]).toContain('node cli/merge-tracker.mjs --re-eval="$NUM"');
    // Default (no PDF): tailor-cv step must NOT be present.
    expect(built!.args[1]).not.toContain('tailor-cv');
    expect(built!.args[1]).toContain('[1/4]');
    expect(built!.args[1]).toContain('[4/4]');
  });

  it('screen-evaluate with generate_pdf=true — chains tailor-cv before merge-tracker', () => {
    const built = buildCommand(
      'screen-evaluate',
      { url: 'https://boards.greenhouse.io/acme/jobs/123', generate_pdf: true },
      root,
    );
    expect(built).not.toBeNull();
    expect(built!.cmd).toBe('/bin/bash');
    expect(built!.args[1]).toContain('set -o pipefail');
    expect(built!.args[1]).toContain('node batch/mode-runner.mjs evaluate --num "$NUM"');
    expect(built!.args[1]).toContain('node batch/mode-runner.mjs tailor-cv --num "$NUM"');
    expect(built!.args[1]).toContain('node cli/merge-tracker.mjs --re-eval="$NUM"');
    // tailor-cv must appear before merge-tracker in the script.
    expect(built!.args[1].indexOf('tailor-cv')).toBeLessThan(
      built!.args[1].indexOf('merge-tracker.mjs --re-eval'),
    );
    expect(built!.args[1]).toContain('[1/5]');
    expect(built!.args[1]).toContain('[5/5]');
  });
});
