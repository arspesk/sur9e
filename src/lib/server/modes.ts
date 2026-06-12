// src/lib/server/modes.ts
//
// Reads content/modes/*.md and returns a typed ModeManifest keyed by
// modeId (filename sans `.md`). Each entry is the validated front-matter
// merged with `{ modeId, body }`. Files without front-matter parse as
// ModeFrontMatterDefaults so the front-matter rollout (adding front-matter
// to every mode file) can land file-by-file without breaking the loader
// mid-flight. `_`-prefixed files are excluded — `_shared.md` is a
// prelude include, `_smoke.md` (future) is test-only.
//
// Memoized per React render via `cache()` from `react` — same pattern as
// `loadApplications` in `src/lib/server/applications.ts`. Tests don't
// need a manual bust because each test fixture lives in its own tmpdir,
// so the call arguments differ.
//
// server-only: uses node:fs, so it must never end up in a client bundle.

import 'server-only';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { cache } from 'react';
import { ModeFrontMatter, ModeFrontMatterDefaults, type ModeMeta } from '../schemas/modes';

export type ModeManifest = Record<string, ModeMeta>;

const FRONT_MATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export const loadModeManifest = cache((rootPath: string): ModeManifest => {
  const dir = join(rootPath, 'content/modes');
  if (!existsSync(dir)) return {};
  const manifest: ModeManifest = {};
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    // _shared.md is a prelude include; _smoke.md (future) is test-only.
    if (name.startsWith('_')) continue;
    const modeId = name.replace(/\.md$/, '');
    const raw = readFileSync(join(dir, name), 'utf-8');
    const match = raw.match(FRONT_MATTER_RE);
    let parsed: ModeFrontMatter;
    let body: string;
    if (match) {
      const fmObj = yaml.load(match[1]) ?? {};
      parsed = ModeFrontMatter.parse(fmObj);
      body = match[2];
    } else {
      parsed = ModeFrontMatterDefaults;
      body = raw;
    }
    manifest[modeId] = { ...parsed, modeId, body };
  }
  return manifest;
});
