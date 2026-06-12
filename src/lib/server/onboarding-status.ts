// lib/server/onboarding-status.ts — first-run setup detection.
//
// Mirrors the agent-side detection in docs/onboarding.md Step 0: sur9e
// can't screen, scan, or evaluate anything until the user's CV
// (inputs/personalization/cv.md) and profile
// (inputs/personalization/profile.yml) exist — batch/screen.mjs hard-exits
// when cv.md is missing. This module gives the web layer the same check so
// startJobAction can refuse to spawn a doomed job and the UI can point a
// fresh-install user at the real onboarding path instead of an "exit 1"
// card.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type OnboardingMissing = 'cv' | 'profile';

export interface OnboardingStatus {
  ready: boolean;
  missing: OnboardingMissing[];
}

const REQUIRED_FILES: Record<OnboardingMissing, string> = {
  cv: join('inputs', 'personalization', 'cv.md'),
  profile: join('inputs', 'personalization', 'profile.yml'),
};

/** Which required personalization files are missing under `root`. */
export function getOnboardingStatus(root: string): OnboardingStatus {
  const missing = (Object.keys(REQUIRED_FILES) as OnboardingMissing[]).filter(
    key => !existsSync(join(root, REQUIRED_FILES[key])),
  );
  return { ready: missing.length === 0, missing };
}

const MISSING_LABEL: Record<OnboardingMissing, string> = {
  cv: 'your CV (inputs/personalization/cv.md)',
  profile: 'your profile (inputs/personalization/profile.yml)',
};

/**
 * Actionable plain-text message for a setup-required refusal. Rendered as
 * a toast / inline form error, so it must carry the full next step in
 * words: open the AI coding agent in the sur9e folder and it walks the
 * user through setup (docs/onboarding.md).
 */
export function onboardingSetupMessage(missing: OnboardingMissing[]): string {
  const what = missing.map(key => MISSING_LABEL[key]).join(' and ');
  return `Finish setup first — ${what} ${missing.length > 1 ? 'are' : 'is'} missing. Open your AI coding agent in the sur9e folder and it will walk you through setup, or start on the Profile page.`;
}
