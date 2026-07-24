import 'server-only';
import { JobType as JobTypeSchema } from '../../schemas/jobs';
import { findByNum } from '../applications';
import {
  getOnboardingStatus,
  type OnboardingMissing,
  onboardingSetupMessage,
} from '../onboarding-status';
import { createJob, findActiveJob, type JobRecord, type JobType, listActiveJobs } from './api';

/** Job kinds that operate on a single tracked offer and require params.num. */
export const JOB_KIND_BY_NUM = new Set<JobType>([
  'evaluate',
  'tailor-cv',
  'cover-letter',
  'research',
  'interview-prep',
  'reach-out',
  'negotiate',
]);

// `screen` is singleton: batch/screen.mjs + merge-tracker share state —
// pipeline.md, applications.md, screened-urls.txt, the
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
 * { conflict: true, message, job } payload instead of throwing — callers
 * branch on the `conflict` discriminator.
 */
export function startJob(
  rootPath: string,
  input: StartJobInput,
): JobRecord | JobConflictPayload | JobSetupRequiredPayload {
  const kind = kindSchema.parse(input.kind);
  const params = (input.params ?? {}) as Record<string, unknown>;

  // First-run preflight: every job kind reads the user's CV + profile
  // (screen/scan workers hard-exit without them), so refuse with an
  // actionable setup pointer instead of queuing a guaranteed failure.
  const onboarding = getOnboardingStatus(rootPath);
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
    if (!findByNum(rootPath, num as number)) {
      throw new Error(`num not found: ${num}`);
    }
    // Block a duplicate of the SAME per-offer kind for the SAME offer. Two
    // concurrent cover-letter / evaluate / tailor-cv / … runs on one offer are
    // wasted paid work and race on the same report/output files. (Singleton
    // kinds get their own family guard below; this covers the per-offer kinds.)
    const duplicate = listActiveJobs(rootPath, kind).find(
      j => Number((j.params as Record<string, unknown> | undefined)?.num) === num,
    );
    if (duplicate) {
      const label = (kind as string).replace(/-/g, ' ');
      return {
        conflict: true,
        message: `a ${label} job for offer #${num} is already running`,
        job: duplicate,
      };
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
      const active = findActiveJob(rootPath, k);
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

  return createJob(rootPath, kind, finalParams);
}
