// src/lib/server/__tests__/jobs-command-registry.test.ts
//
// Parse-boundary tests for the typed command-registry wrapper. Every
// JobType gets exercised against a tmp root with a known applications.md
// + artifacts/reports/* fixture. Mirrors the surface of jobs-buildcommand.test.mjs
// — that test still drives the .mjs runtime end-to-end via createJob;
// this test exercises the typed buildCommand directly so we can assert
// JobCommand-shaped returns without spawning a subprocess.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobCommand } from '../../schemas/jobs';
import { buildCommand, guessCompanyFromURL } from '../jobs/command-registry';

function makeTmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'jobs-command-registry-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'data/jobs'));
  mkdirSync(join(root, 'artifacts', 'reports'), { recursive: true });
  mkdirSync(join(root, 'inputs', 'config'), { recursive: true });
  writeFileSync(
    join(root, 'data/applications.md'),
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 42 | 2026-05-06 | TestCo | Engineer | 4.0/5 | Evaluated | ❌ | [42](artifacts/reports/42-testco.md) | smoke |',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'artifacts/reports/42-testco.md'),
    '**URL:** https://example.com/jobs/42\n\nbody\n',
  );
  return root;
}

describe('jobs/command-registry', () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('buildCommand returns a JobCommand for each valid JobType', () => {
    it('scan — fixed pipeline command', () => {
      const cmd = buildCommand('scan', {}, root);
      expect(cmd).not.toBeNull();
      expect(() => JobCommand.parse(cmd)).not.toThrow();
      expect(cmd?.cmd).toBe('/bin/bash');
      expect(cmd?.args[0]).toBe('-c');
      expect(cmd?.args[1]).toContain('batch/scan-jobspy.mjs');
    });

    it('batch-evaluate — uses default threshold when not provided', () => {
      const cmd = buildCommand('batch-evaluate', {}, root);
      expect(cmd).not.toBeNull();
      expect(() => JobCommand.parse(cmd)).not.toThrow();
      expect(cmd?.args[1]).toContain('--parallel');
      expect(cmd?.args[1]).toContain('--min-score');
    });

    it('screen — passes URL as a positional arg to add-to-pipeline', () => {
      const cmd = buildCommand('screen', { url: 'https://example.com/jobs/99' }, root);
      expect(cmd).not.toBeNull();
      expect(() => JobCommand.parse(cmd)).not.toThrow();
      // The URL is passed as a positional bash arg ($1), not interpolated into
      // the command string, so it can't break out of the shell.
      expect(cmd?.args[1]).toContain('add-to-pipeline.mjs "$1" "$2"');
      expect(cmd?.args).toContain('https://example.com/jobs/99');
    });

    it('screen-evaluate — chains add-to-pipeline, screen, num resolution, evaluate', () => {
      const cmd = buildCommand('screen-evaluate', { url: 'https://example.com/jobs/99' }, root);
      expect(cmd).not.toBeNull();
      expect(() => JobCommand.parse(cmd)).not.toThrow();
      // URL/company travel as positional bash args, never interpolated.
      expect(cmd?.args[1]).toContain('add-to-pipeline.mjs "$1" "$2"');
      expect(cmd?.args[1]).toContain('screen.mjs --url "$1"');
      expect(cmd?.args[1]).toContain('num-by-url.mjs "$1"');
      expect(cmd?.args[1]).toContain('mode-runner.mjs evaluate --num "$NUM"');
      expect(cmd?.args[1]).toContain('merge-tracker.mjs --re-eval="$NUM"');
      expect(cmd?.args).toContain('https://example.com/jobs/99');
    });

    it('evaluate — routes through mode-runner + merge-tracker re-eval', () => {
      const cmd = buildCommand('evaluate', { num: 42 }, root);
      expect(cmd).not.toBeNull();
      expect(() => JobCommand.parse(cmd)).not.toThrow();
      // Input loading + provider spawn moved into batch/mode-runner.mjs;
      // the registry branch is now a thin script that calls it then merges.
      expect(cmd?.args[1]).toContain('node batch/mode-runner.mjs evaluate --num 42');
      expect(cmd?.args[1]).toContain('node cli/merge-tracker.mjs --re-eval=42');
      // No generators unless asked: 3-step chain, no PDF modes.
      expect(cmd?.args[1]).toContain('[3/3] Done');
      expect(cmd?.args[1]).not.toContain('tailor-cv');
      expect(cmd?.args[1]).not.toContain('cover-letter');
    });

    it('evaluate — generate_pdf chains tailor-cv before the merge', () => {
      const cmd = buildCommand('evaluate', { num: 42, generate_pdf: true }, root);
      const script = cmd?.args[1] ?? '';
      expect(script).toContain('node batch/mode-runner.mjs tailor-cv --num 42');
      expect(script).toContain('[4/4] Done');
      expect(script.indexOf('tailor-cv')).toBeLessThan(script.indexOf('--re-eval=42'));
      expect(script).not.toContain('cover-letter');
    });

    it('evaluate — generate_cover_letter chains cover-letter before the merge', () => {
      const cmd = buildCommand('evaluate', { num: 42, generate_cover_letter: true }, root);
      const script = cmd?.args[1] ?? '';
      expect(script).toContain('node batch/mode-runner.mjs cover-letter --num 42');
      expect(script).toContain('[4/4] Done');
      expect(script.indexOf('cover-letter')).toBeLessThan(script.indexOf('--re-eval=42'));
      expect(script).not.toContain('tailor-cv');
    });

    it('evaluate — both flags chain tailor-cv then cover-letter (5 steps)', () => {
      const cmd = buildCommand(
        'evaluate',
        { num: 42, generate_pdf: true, generate_cover_letter: true },
        root,
      );
      const script = cmd?.args[1] ?? '';
      expect(script).toContain('node batch/mode-runner.mjs tailor-cv --num 42');
      expect(script).toContain('node batch/mode-runner.mjs cover-letter --num 42');
      expect(script).toContain('[5/5] Done');
      expect(script.indexOf('tailor-cv')).toBeLessThan(script.indexOf('cover-letter --num'));
    });

    it('screen-evaluate — both flags extend the chain to 6 steps', () => {
      const cmd = buildCommand(
        'screen-evaluate',
        { url: 'https://example.com/jobs/99', generate_pdf: true, generate_cover_letter: true },
        root,
      );
      const script = cmd?.args[1] ?? '';
      expect(script).toContain('node batch/mode-runner.mjs tailor-cv --num "$NUM"');
      expect(script).toContain('node batch/mode-runner.mjs cover-letter --num "$NUM"');
      expect(script).toContain('[6/6] Merging');
    });

    it.each([
      'research',
      'interview-prep',
      'reach-out',
      'negotiate',
    ] as const)('%s — routes through mode-runner', type => {
      const cmd = buildCommand(type, { num: 42 }, root);
      expect(cmd).not.toBeNull();
      expect(() => JobCommand.parse(cmd)).not.toThrow();
      expect(cmd?.args[1]).toContain(`node batch/mode-runner.mjs ${type} --num 42`);
      expect(cmd?.args[1]).toContain('set -o pipefail');
    });

    it.each(['tailor-cv', 'cover-letter'] as const)('%s — routes through mode-runner', type => {
      const cmd = buildCommand(type, { num: 42 }, root);
      expect(cmd).not.toBeNull();
      expect(() => JobCommand.parse(cmd)).not.toThrow();
      // Input loading + provider spawn moved into batch/mode-runner.mjs;
      // the registry branch is now a thin script that calls it.
      expect(cmd?.args[1]).toContain(`node batch/mode-runner.mjs ${type} --num 42`);
      expect(cmd?.args[1]).toContain('set -o pipefail');
    });
  });

  describe('buildCommand returns null for invalid params', () => {
    it('screen — missing url is QUEUE mode (screen all pending), not an error', () => {
      const cmd = buildCommand('screen', {} as Record<string, unknown>, root);
      expect(cmd).not.toBeNull();
      expect(cmd?.args[1]).toBe('node batch/screen.mjs && node cli/merge-tracker.mjs');
      // No --url scoping and no add-to-pipeline in queue mode.
      expect(cmd?.args[1]).not.toContain('--url');
      expect(cmd?.args[1]).not.toContain('add-to-pipeline');
    });

    it('screen — non-string url is rejected (not silently queue mode)', () => {
      expect(buildCommand('screen', { url: 42 } as Record<string, unknown>, root)).toBeNull();
    });

    it('screen — non-http url', () => {
      expect(buildCommand('screen', { url: 'ftp://nope.example' }, root)).toBeNull();
    });

    it('screen-evaluate — missing url', () => {
      expect(buildCommand('screen-evaluate', {} as Record<string, unknown>, root)).toBeNull();
    });

    it('screen-evaluate — non-http url', () => {
      expect(buildCommand('screen-evaluate', { url: 'ftp://nope.example' }, root)).toBeNull();
    });

    it.each([
      'evaluate',
      'research',
      'interview-prep',
      'reach-out',
      'tailor-cv',
      'cover-letter',
    ] as const)('%s — non-integer num', type => {
      expect(buildCommand(type, { num: 'oops' } as Record<string, unknown>, root)).toBeNull();
    });

    // Note: evaluate + the section jobs (research/interview-prep/outreach/
    // negotiate) and now tailor-cv/cover-letter no longer read
    // applications.md at build time — input loading moved into
    // batch/mode-runner.mjs — so an absent row no longer degrades to null;
    // the runner reports the missing offer instead.
  });

  describe('guessCompanyFromURL', () => {
    it('greenhouse', () => {
      expect(guessCompanyFromURL('https://boards.greenhouse.io/anduril/jobs/12345')).toBe(
        'anduril',
      );
    });

    it('lever (path)', () => {
      expect(guessCompanyFromURL('https://jobs.lever.co/replicate/abc')).toBe('replicate');
    });

    it('ashbyhq', () => {
      expect(guessCompanyFromURL('https://jobs.ashbyhq.com/openai/role-id')).toBe('openai');
    });

    it('workday subdomain', () => {
      expect(guessCompanyFromURL('https://pinterest.wd1.myworkdayjobs.com/Pinterest/job/foo')).toBe(
        'pinterest',
      );
    });

    it('fallback to registrable host', () => {
      expect(guessCompanyFromURL('https://careers.acme.com/jobs/1')).toBe('acme');
    });

    it('garbage url → empty string', () => {
      expect(guessCompanyFromURL('not a url')).toBe('');
    });
  });
});
