'use server';

// Server Actions for profile.
//
// Merge semantics: profile.yml top-level keys are full-replaced when
// present in the patch body. /api/profile/* stays as the JSON compatibility
// surface.

import { join } from 'node:path';
import { ROOT } from '@/lib/root';
import { atomicWrite } from '@/lib/server/atomic-write';
import { loadProfile, saveProfile } from '@/lib/server/profile';
import { revalidatePath } from '@/server/revalidate';

const MD_FILES: Record<string, string> = {
  cv: 'inputs/personalization/cv.md',
  narrative: 'inputs/personalization/narrative.md',
  'article-digest': 'inputs/personalization/article-digest.md',
};

const PROFILE_TOP_KEYS = [
  'candidate',
  'target_roles',
  'narrative',
  'compensation',
  'location',
  'languages',
  'search',
  'apply_answers',
] as const;

export interface SaveProfileResult {
  ok: true;
  profileChanged: boolean;
}

export async function saveProfileAction(
  patch: Record<string, unknown>,
): Promise<SaveProfileResult> {
  if (!patch || typeof patch !== 'object') {
    throw new Error('patch must be an object');
  }

  // Cast through unknown — loadProfile returns a typed shape but the merge
  // writes back to a mutable record (matches the PATCH route's behavior).
  // The schema parse on saveProfile() narrows it again.
  const profile = (loadProfile(ROOT) ?? {}) as Record<string, unknown>;

  let profileChanged = false;

  for (const key of PROFILE_TOP_KEYS) {
    if (patch[key] !== undefined) {
      profile[key] = patch[key];
      profileChanged = true;
    }
  }

  if (profileChanged) {
    saveProfile(ROOT, profile);
    // revalidatePath (not tag-based caching): profile.yml can be hand-edited
    // outside the app — the onboarding flow encourages editing
    // inputs/personalization/*.yml directly. A tag-based cache would mask
    // those writes.
    revalidatePath('/profile');
  }

  return { ok: true, profileChanged };
}

export interface SaveProfileMarkdownInput {
  name: string;
  content: string;
}

export async function saveProfileMarkdownAction(
  input: SaveProfileMarkdownInput,
): Promise<{ ok: true }> {
  const rel = MD_FILES[input.name];
  if (!rel) {
    throw new Error(`unknown md file: ${input.name}`);
  }
  const abs = join(ROOT, rel);
  // Atomic write so a crash mid-save can't truncate the user's CV /
  // narrative / digest. atomicWrite stages a .tmp, rotates the previous
  // good copy to .bak, then renames .tmp into place.
  atomicWrite(abs, input.content);
  revalidatePath('/profile');
  return { ok: true };
}
