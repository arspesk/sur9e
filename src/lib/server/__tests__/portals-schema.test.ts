// Parse-boundary + summary tests for the ATS portals entrypoint. Copies the
// tracked example portals.yml into a tmpdir to assert parse; never reads or
// mutates the user's live inputs/personalization/portals.yml. The example is
// deterministic and always non-empty, so the "parses tracked_companies" check
// holds in CI and locally regardless of the user's own (possibly empty) file.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PortalsShape } from '../../schemas/portals';
import { detectProvider, loadPortals, savePortals, summarizePortals } from '../portals';

const FIXTURE_PORTALS = join(
  process.cwd(),
  'content',
  'examples',
  'personalization',
  'portals.yml',
);

function makeTmpRootFromFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'portals-schema-test-'));
  mkdirSync(join(root, 'inputs', 'personalization'), { recursive: true });
  copyFileSync(FIXTURE_PORTALS, join(root, 'inputs', 'personalization', 'portals.yml'));
  return root;
}

describe('portals.ts — schema boundary', () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpRootFromFixture();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('loadPortals parses the fixture portals.yml into tracked_companies', () => {
    expect(existsSync(FIXTURE_PORTALS)).toBe(true);
    const portals = loadPortals(root);
    expect(portals).not.toBeNull();
    expect(Array.isArray(portals?.tracked_companies)).toBe(true);
    expect(portals?.tracked_companies?.length ?? 0).toBeGreaterThan(0);
    expect(() => PortalsShape.parse(portals)).not.toThrow();
  });

  it('loadPortals returns null when portals.yml is missing', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'portals-empty-'));
    try {
      expect(loadPortals(emptyRoot)).toBeNull();
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('savePortals round-trips through loadPortals', () => {
    const portals = loadPortals(root);
    expect(portals).not.toBeNull();
    savePortals(root, portals);
    const reloaded = loadPortals(root);
    expect(reloaded).toEqual(portals);
  });
});

describe('PortalsShape', () => {
  it('defaults tracked_companies to an empty array', () => {
    expect(PortalsShape.parse({}).tracked_companies).toEqual([]);
  });

  it('passes through unknown keys (hand-edited files are lenient)', () => {
    const parsed = PortalsShape.parse({
      tracked_companies: [
        { name: 'X', careers_url: 'https://jobs.lever.co/x', scan_method: 'old' },
      ],
    });
    // Legacy/unknown per-entry keys survive the passthrough.
    expect((parsed.tracked_companies[0] as Record<string, unknown>).scan_method).toBe('old');
  });

  it('rejects a company with a non-string name', () => {
    expect(() => PortalsShape.parse({ tracked_companies: [{ name: 42 }] })).toThrow();
  });

  it('preserves a custom-parser block (so a UI save never strips it)', () => {
    const parser = {
      command: 'node',
      script: 'inputs/parsers/acme.mjs',
      args: ['--url', '{careers_url}'],
    };
    const parsed = PortalsShape.parse({
      tracked_companies: [{ name: 'Acme', careers_url: 'https://acme.example.com', parser }],
    });
    expect(parsed.tracked_companies[0].parser).toEqual(parser);
  });
});

describe('detectProvider', () => {
  it('detects each supported provider from careers_url / api', () => {
    expect(
      detectProvider({ api: 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs' }),
    ).toBe('greenhouse');
    expect(detectProvider({ careers_url: 'https://job-boards.greenhouse.io/anthropic' })).toBe(
      'greenhouse',
    );
    expect(detectProvider({ careers_url: 'https://job-boards.eu.greenhouse.io/polyai' })).toBe(
      'greenhouse',
    );
    expect(detectProvider({ careers_url: 'https://jobs.ashbyhq.com/cohere' })).toBe('ashby');
    expect(detectProvider({ careers_url: 'https://jobs.lever.co/mistral' })).toBe('lever');
    expect(detectProvider({ careers_url: 'https://apply.workable.com/huggingface/' })).toBe(
      'workable',
    );
    expect(detectProvider({ careers_url: 'https://nvidia.wd5.myworkdayjobs.com/External' })).toBe(
      'workday',
    );
    expect(detectProvider({ careers_url: 'https://acme.recruitee.com/' })).toBe('recruitee');
    expect(detectProvider({ careers_url: 'https://careers.smartrecruiters.com/acme' })).toBe(
      'smartrecruiters',
    );
    expect(detectProvider({ careers_url: 'https://solid.jobs/public-api/offers/it' })).toBe(
      'solidjobs',
    );
  });

  it('returns null when no feed is derivable', () => {
    expect(detectProvider({ careers_url: 'https://example.com/careers' })).toBeNull();
    expect(detectProvider({})).toBeNull();
  });
});

describe('summarizePortals', () => {
  it('returns an all-zero summary for null / empty', () => {
    expect(summarizePortals(null)).toEqual({
      total: 0,
      enabled: 0,
      scannable: 0,
      byProvider: {
        greenhouse: 0,
        ashby: 0,
        lever: 0,
        workable: 0,
        workday: 0,
        recruitee: 0,
        smartrecruiters: 0,
        solidjobs: 0,
      },
    });
  });

  it('counts total, enabled, scannable, and per-provider correctly', () => {
    const summary = summarizePortals({
      tracked_companies: [
        { name: 'A', api: 'https://boards-api.greenhouse.io/v1/boards/a/jobs' },
        { name: 'B', careers_url: 'https://jobs.ashbyhq.com/b' },
        { name: 'C', careers_url: 'https://jobs.lever.co/c' },
        // disabled — excluded from enabled + scannable
        { name: 'D', careers_url: 'https://jobs.lever.co/d', enabled: false },
        // enabled but no derivable feed — counts as enabled, not scannable
        { name: 'E', careers_url: 'https://example.com/careers' },
      ],
    });
    expect(summary.total).toBe(5);
    expect(summary.enabled).toBe(4);
    expect(summary.scannable).toBe(3);
    expect(summary.byProvider).toEqual({
      greenhouse: 1,
      ashby: 1,
      lever: 1,
      workable: 0,
      workday: 0,
      recruitee: 0,
      smartrecruiters: 0,
      solidjobs: 0,
    });
  });
});
