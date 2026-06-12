// loadProfile returns null when inputs/personalization/profile.yml is
// missing; callers in /api/profile coalesce with `?? {}`. Schema parsing
// only runs against non-null results.
//
// Parse failures (hand-edited YAML gone wrong, schema-invalid shapes) fail
// SOFT: loadProfileResult returns a structured error so /profile can render
// an actionable "profile unreadable" message, while loadProfile degrades to
// null so enrichment-only callers (findByNum, /api/profile) keep working
// instead of 500ing every offer detail. Mirrors the loadSettings precedent.

import 'server-only';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { ProfileShape } from '../schemas/profile';
import { atomicWrite } from './atomic-write';
import { describeParseError } from './parse-error';
import { readFileOrNull } from './read-or-null';

const PROFILE_FILE = 'inputs/personalization/profile.yml';

export type { ProfileShape as ProfileShapeType } from '../schemas/profile';
export { ProfileShape };

export interface ProfileLoadError {
  /** Repo-relative path of the unreadable file. */
  path: string;
  /** Short human-readable cause (YAML reason or zod `path: message` pairs). */
  message: string;
  /** 1-based YAML error line, when the parser knows it. */
  line: number | null;
}

export interface ProfileLoadResult {
  /** Parsed profile, or null when the file is missing, empty, or unreadable. */
  profile: ProfileShape | null;
  /** Set only when the file EXISTS but could not be parsed (YAML or schema). */
  error: ProfileLoadError | null;
}

export function loadProfileResult(rootPath: string): ProfileLoadResult {
  const filePath = join(rootPath, PROFILE_FILE);
  const content = readFileOrNull(filePath);
  if (content == null) return { profile: null, error: null };
  try {
    const raw = yaml.load(content);
    if (raw == null) return { profile: null, error: null };
    return { profile: ProfileShape.parse(raw), error: null };
  } catch (err) {
    const { message, line } = describeParseError(err);
    console.warn(`[profile] failed to parse ${filePath}: ${message}`);
    return { profile: null, error: { path: PROFILE_FILE, message, line } };
  }
}

export function loadProfile(rootPath: string): ProfileShape | null {
  return loadProfileResult(rootPath).profile;
}

export function saveProfile(rootPath: string, data: unknown): void {
  // Refuse to overwrite an existing-but-unreadable profile.yml. Callers
  // merge their patch into `loadProfile(ROOT) ?? {}` — when the file failed
  // to parse, that "existing" base is empty, so writing would replace every
  // hand-edited key with only the patched ones (silent data loss; the .bak
  // rotates away on the next save). Mirrors saveSettings' refusal.
  const { error } = loadProfileResult(rootPath);
  if (error) {
    throw new Error(
      `refusing to save profile: ${error.path} exists but failed to parse (${error.message}). ` +
        'Fix or remove the file first — saving now would overwrite it with only the latest form values.',
    );
  }
  // Validate at the save boundary too — catches accidental writes of
  // malformed profile blobs (wrong types, unexpected nesting). Accepts
  // `unknown` because callers (e.g. app/api/profile/route.ts) mutate a
  // record-typed object and we want the schema to do the narrowing.
  const parsed = ProfileShape.parse(data);
  const filePath = join(rootPath, PROFILE_FILE);
  const yamlStr = yaml.dump(parsed, { lineWidth: 100, noRefs: true });
  atomicWrite(filePath, yamlStr);
}
