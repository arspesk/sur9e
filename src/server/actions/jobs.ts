'use server';

// One generic action (startJobAction) wraps lib/server/jobs.createJob —
// kind is part of the input, mirroring useJobAction(kind). Avoids 9
// near-identical wrappers.
//
// Conflicts for 'scan' and 'batch-evaluate' return a tagged
// { conflict: true } payload (no throw), so the hook can render an info
// toast without treating it as an error.
//
// Per-num kinds (evaluate / tailor-cv / …) call findByNum upfront and
// throw "Offer not found" before queuing.
//
// No revalidatePath here: createJob writes data/jobs/<id>.json (which
// RSC pages don't read; the client polls /api/jobs/[id]). The spawned
// shell may later write data/applications.md out-of-band; the table's
// own polling picks that up. Revalidating /table here would fire
// BEFORE the shell finished — no-op at best, stale-cache trap at worst.

import { z } from 'zod';
import { ROOT } from '@/lib/root';
import { JobType as JobTypeSchema } from '@/lib/schemas/jobs';
import { findByNum } from '@/lib/server/applications';
import { createJob, findActiveJob, type JobRecord, type JobType } from '@/lib/server/jobs';
import {
  getOnboardingStatus,
  type OnboardingMissing,
  onboardingSetupMessage,
} from '@/lib/server/onboarding-status';

const JOB_KIND_BY_NUM = new Set<JobType>([
  'evaluate',
  'tailor-cv',
  'cover-letter',
  'research',
  'interview-prep',
  'reach-out',
  'negotiate',
]);

// `screen` is singleton: batch/screen.mjs + merge-tracker
// share state — pipeline.md, applications.md, screened-urls.txt, the
// `batch/tracker-additions/` TSVs — and have no per-call locking. Two
// concurrent screen jobs each see the same pending URLs in pipeline.md,
// both write reports + TSVs to the same paths, then race on the
// merge-tracker rename (the second hits ENOENT because the first
// already moved the TSV). Serializing fixes the data corruption.
const JOB_KIND_SINGLETON = new Set<JobType>([
  'scan',
  'batch-evaluate',
  'screen',
  'screen-evaluate',
]);

// Derive from the canonical JobType enum (schemas/jobs) rather than re-listing
// the kinds — a duplicated list silently drifts (it's how 'negotiate' got
// rejected here after being added to JOB_TYPES everywhere else).
const kindSchema = JobTypeSchema;

export interface JobConflictPayload {
  conflict: true;
  message: string;
  job: JobRecord;
}

/**
 * First-run preflight refusal: cv.md / profile.yml are missing, so any
 * spawned worker would hard-fail (batch/screen.mjs exits 1 without cv.md)
 * and the user's first action would end in an opaque "exit 1" card.
 *
 * Carries `conflict: true` on purpose: legacy callers that only know the
 * conflict discriminator (e.g. screen-modal) surface `message` as a
 * non-fatal inline error — which is exactly the actionable copy we want
 * shown. Newer callers branch on `setupRequired` first.
 */
export interface JobSetupRequiredPayload {
  conflict: true;
  setupRequired: true;
  message: string;
  missing: OnboardingMissing[];
}

export interface StartJobInput {
  kind: JobType;
  params?: Record<string, unknown>;
}

/**
 * Start a background job. Returns the freshly-created JobRecord on success.
 *
 * On conflict (an active scan / batch-evaluate already running) returns a
 * { conflict: true, message, job } payload instead of throwing — the hook
 * branches on the `conflict` discriminator to push the legacy info toast
 * without treating it as a hard failure.
 */
export async function startJobAction(
  input: StartJobInput,
): Promise<JobRecord | JobConflictPayload | JobSetupRequiredPayload> {
  const kind = kindSchema.parse(input.kind);
  const params = (input.params ?? {}) as Record<string, unknown>;

  // First-run preflight: every job kind reads the user's CV + profile
  // (screen/scan workers hard-exit without them), so refuse with an
  // actionable setup pointer instead of queuing a guaranteed failure.
  const onboarding = getOnboardingStatus(ROOT);
  if (!onboarding.ready) {
    return {
      conflict: true,
      setupRequired: true,
      message: onboardingSetupMessage(onboarding.missing),
      missing: onboarding.missing,
    };
  }

  if (JOB_KIND_BY_NUM.has(kind)) {
    const num = params.num;
    if (!Number.isInteger(num)) {
      throw new Error('missing or non-integer num');
    }
    if (!findByNum(ROOT, num as number)) {
      throw new Error(`num not found: ${num}`);
    }
  }

  if (JOB_KIND_SINGLETON.has(kind)) {
    // scan, batch-evaluate, and the screen pair all run the screen.mjs +
    // merge-tracker chain over the same unlocked state (pipeline.md,
    // screened-urls.txt, tracker-additions/), so scan/batch-evaluate block
    // the whole family; a single-url screen only blocks its screen sibling.
    const kindsToCheck: JobType[] =
      kind === 'screen' || kind === 'screen-evaluate'
        ? ['screen', 'screen-evaluate']
        : ['scan', 'screen', 'screen-evaluate', 'batch-evaluate'];
    for (const k of kindsToCheck) {
      const active = findActiveJob(ROOT, k);
      if (active) {
        const noun = k === 'scan' ? 'scan' : k === 'batch-evaluate' ? 'batch evaluation' : 'screen';
        return { conflict: true, message: `a ${noun} is already running`, job: active };
      }
    }
  }

  if (kind === 'screen' || kind === 'screen-evaluate') {
    const url = params.url;
    // 'screen' with no url is the queue mode used by Settings → Job scanning
    // ("Screen pending"): batch/screen.mjs screens every pending entry. Only
    // 'screen-evaluate' (add a specific offer + evaluate) requires a url.
    // When a url IS supplied it must be a valid http(s) URL either way.
    const urlRequired = kind === 'screen-evaluate';
    if (url === undefined || url === null) {
      if (urlRequired) throw new Error('url must start with http:// or https://');
    } else if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error('url must start with http:// or https://');
    }
  }

  let finalParams = params;
  if (kind === 'batch-evaluate') {
    finalParams = {
      parallel: Number.isInteger(params.parallel) ? params.parallel : 4,
      min_score: Number.isFinite(params.min_score) ? params.min_score : 3,
    };
  }

  return createJob(ROOT, kind, finalParams);
}
