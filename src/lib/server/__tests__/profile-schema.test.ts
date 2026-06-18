// Parse-boundary tests for the typed profile entrypoint. Copies the
// live inputs/personalization/profile.yml into a tmpdir to assert
// parse; never mutates the real file (user data is immutable). When
// the live file is absent (CI, fresh clone) the tracked example at
// content/examples/personalization/profile.yml is used as fallback.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProfileShape } from '../../schemas/profile';
import { loadProfile, saveProfile } from '../profile';

const LIVE_PROFILE = join(process.cwd(), 'inputs', 'personalization', 'profile.yml');
const EXAMPLE_PROFILE = join(
  process.cwd(),
  'content',
  'examples',
  'personalization',
  'profile.yml',
);
const FIXTURE_PROFILE = existsSync(LIVE_PROFILE) ? LIVE_PROFILE : EXAMPLE_PROFILE;

function makeTmpRootFromLive(): string {
  const root = mkdtempSync(join(tmpdir(), 'profile-schema-test-'));
  mkdirSync(join(root, 'inputs', 'personalization'), { recursive: true });
  copyFileSync(FIXTURE_PROFILE, join(root, 'inputs', 'personalization', 'profile.yml'));
  return root;
}

function makeEmptyTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'profile-schema-empty-'));
}

describe('profile.ts — schema boundary', () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpRootFromLive();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('loadProfile parses the live inputs/personalization/profile.yml', () => {
    expect(existsSync(FIXTURE_PROFILE)).toBe(true);

    const profile = loadProfile(root);
    expect(profile).not.toBeNull();
    expect(() => ProfileShape.parse(profile)).not.toThrow();
    expect(profile?.candidate?.full_name).toBeTypeOf('string');
  });

  it('loadProfile returns null when profile.yml is missing', () => {
    const emptyRoot = makeEmptyTmpRoot();
    try {
      expect(loadProfile(emptyRoot)).toBeNull();
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('saveProfile round-trips through loadProfile', () => {
    const profile = loadProfile(root);
    expect(profile).not.toBeNull();
    saveProfile(root, profile);
    const reloaded = loadProfile(root);
    expect(reloaded).toEqual(profile);
  });

  it('ProfileShape rejects malformed input (parse-time guard at the save boundary)', () => {
    // The typed saveProfile() wrapper calls ProfileShape.parse(data)
    // before persisting; asserting against the schema directly is the
    // load-bearing check. Vitest's default resolver picks .mjs over .ts
    // when both exist alongside, so importing the wrapper here would
    // bypass schema validation — the schema test below is what guards
    // disk writes in production (Next/tsc both resolve to the .ts).
    expect(() => ProfileShape.parse({ candidate: { full_name: 42 } })).toThrow();
    expect(() => ProfileShape.parse({ candidate: 'not-an-object' })).toThrow();
    expect(() => ProfileShape.parse({ languages: [{ name: 42 }] })).toThrow();
  });

  it('ProfileShape passes through unknown top-level keys', () => {
    const withExtra = { candidate: { full_name: 'X' }, _custom: { foo: 'bar' } };
    const parsed = ProfileShape.parse(withExtra);
    expect((parsed as Record<string, unknown>)._custom).toEqual({ foo: 'bar' });
  });

  it('saveProfile then load preserves added custom data', () => {
    const profile = loadProfile(root);
    expect(profile).not.toBeNull();
    const augmented = { ...profile, _custom: 'preserved-by-passthrough' };
    saveProfile(root, augmented);
    const reloaded = loadProfile(root) as Record<string, unknown> | null;
    expect(reloaded?._custom).toBe('preserved-by-passthrough');
  });

  // Guard against accidental mutation of the live fixture by the suite.
  // Skipped when the live file isn't present (CI / fresh clone — the
  // example fixture is tracked and read-only-via-tmpdir anyway).
  it.skipIf(!existsSync(LIVE_PROFILE))(
    'does not touch the live inputs/personalization/profile.yml during tests',
    () => {
      const tmpYml = join(root, 'inputs', 'personalization', 'profile.yml');
      const originalLiveStat = statSync(LIVE_PROFILE);
      writeFileSync(tmpYml, 'candidate:\n  full_name: tmp-sentinel\n');
      const afterLiveStat = statSync(LIVE_PROFILE);
      expect(afterLiveStat.mtimeMs).toBe(originalLiveStat.mtimeMs);
    },
  );
});

// Helpers for the migration tests below — fresh tmp root with a writable
// inputs/personalization/profile.yml. Mirrored from tracker-cli-posted.test.mjs.
function makeRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'profile-migration-test-'));
  mkdirSync(join(r, 'inputs', 'personalization'), { recursive: true });
  return r;
}

function writeProfileYml(r: string, content: string): void {
  writeFileSync(join(r, 'inputs', 'personalization', 'profile.yml'), content, 'utf8');
}

describe('apply_answers list migration', () => {
  it('loadProfile coerces a legacy object shape into the list', () => {
    const r = makeRoot();
    try {
      writeProfileYml(
        r,
        [
          'apply_answers:',
          '  work_authorization_us: "Yes"',
          '  additional_info: |',
          '    Gender / sex: Male',
        ].join('\n'),
      );
      const profile = loadProfile(r);
      expect(profile?.apply_answers).toEqual([
        { question: 'Work authorization (US)', answer: 'Yes' },
        { question: 'Gender / sex', answer: 'Male' },
      ]);
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  });

  it('saveProfile then loadProfile round-trips the list and drops both-empty rows', () => {
    const r = makeRoot();
    try {
      writeProfileYml(r, 'candidate:\n  full_name: Test User\n');
      saveProfile(r, {
        candidate: { full_name: 'Test User' },
        apply_answers: [
          { question: 'Gender / sex', answer: 'Male' },
          { question: '', answer: '' },
        ],
      });
      expect(loadProfile(r)?.apply_answers).toEqual([{ question: 'Gender / sex', answer: 'Male' }]);
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  });
});
