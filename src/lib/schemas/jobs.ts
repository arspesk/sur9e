// lib/schemas/jobs.ts
//
// Zod schemas for the background-job runner. The runtime in
// src/server/lib/jobs.mjs persists jobs to data/jobs/<id>.json; these
// schemas parse those records at the load/save boundary so the typed
// API layer (src/server/lib/jobs/api.ts) returns validated shapes to
// Next.js routes.

import { z } from 'zod';
import { JOB_MODE_IDS, type JobModeId } from '../modes/catalog';
import { ProviderId } from './providers';

export const JobStatus = z.enum(['queued', 'running', 'done', 'error', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

// Mirrors the literal union used in ModeRuntime.resolvedFrom in
// src/lib/server/providers/registry.ts — keep them in sync.
export const ResolvedFrom = z.enum([
  'run_override',
  'mode_setting',
  'mode_default',
  'global_default',
  'fallback',
]);
export type ResolvedFrom = z.infer<typeof ResolvedFrom>;

export const JOB_TYPES = [...JOB_MODE_IDS] as [JobModeId, ...JobModeId[]];

const CanonicalJobType = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof CanonicalJobType>;

export function normalizeJobType(type: string): JobType | string {
  return type === 'outreach' ? 'reach-out' : type;
}

export const JobType = z.preprocess(
  value => (typeof value === 'string' ? normalizeJobType(value) : value),
  CanonicalJobType,
);

// Params shape varies per job type. Discriminated union for the typed
// surface; the runtime keeps the persisted params bag as-is for now.
export const JobParams = z.preprocess(
  raw => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const row = raw as Record<string, unknown>;
      if (row.type === 'outreach') return { ...row, type: 'reach-out' };
    }
    return raw;
  },
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('evaluate'),
      num: z.number().int().positive(),
      generate_pdf: z.boolean().optional(),
      generate_cover_letter: z.boolean().optional(),
    }),
    z.object({ type: z.literal('tailor-cv'), num: z.number().int().positive() }),
    z.object({ type: z.literal('latex'), num: z.number().int().positive() }),
    z.object({ type: z.literal('cover-letter'), num: z.number().int().positive() }),
    z.object({ type: z.literal('research'), num: z.number().int().positive() }),
    z.object({ type: z.literal('interview-prep'), num: z.number().int().positive() }),
    z.object({ type: z.literal('reach-out'), num: z.number().int().positive() }),
    z.object({ type: z.literal('negotiate'), num: z.number().int().positive() }),
    z.object({ type: z.literal('scan') }),
    z.object({
      type: z.literal('batch-evaluate'),
      parallel: z.number().int().positive().optional(),
      min_score: z.number().optional(),
    }),
    // A `screen` job targets a URL, a tracked pasted-text offer (`num`), or,
    // in queue mode, screens
    // the whole pending pipeline. Queue mode must be opted into explicitly with
    // `queue: true` (see api/jobs/screen route) — it is never inferred from a
    // missing url, so a malformed body can't silently spawn a background job.
    z
      .object({
        type: z.literal('screen'),
        url: z.string().url().optional(),
        num: z.number().int().positive().optional(),
        queue: z.literal(true).optional(),
      })
      .refine(p => typeof p.url === 'string' || typeof p.num === 'number' || p.queue === true, {
        message: 'screen requires a url, num, or queue:true to screen the whole pending pipeline',
      }),
    z
      .object({
        type: z.literal('screen-evaluate'),
        url: z.string().url().optional(),
        num: z.number().int().positive().optional(),
        generate_pdf: z.boolean().optional(),
        generate_cover_letter: z.boolean().optional(),
      })
      .refine(p => typeof p.url === 'string' || typeof p.num === 'number', {
        message: 'screen-evaluate requires a url or tracked offer num',
      }),
  ]),
);
export type JobParams = z.infer<typeof JobParams>;

export const JobRecord = z.object({
  id: z.string().length(16),
  type: JobType,
  status: JobStatus,
  // Persisted params bag stays loose so legacy records keep parsing through
  // even if their shape predates the JobParams discriminated union above.
  params: z.record(z.string(), z.unknown()),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  output: z.string().default(''),
  error: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  // Optional workflow parent metadata. Legacy standalone records omit it;
  // workflow children carry both ids so the UI and recovery path can group
  // and advance them without parsing the free-form params bag.
  workflowId: z.string().length(16).optional(),
  workflowStepId: z.string().min(1).optional(),
  // Pid of the spawned worker process, stamped by the runner on the running
  // record. Drives reap-on-read liveness detection (jobs/stale.ts): a
  // 'running' record whose pid no longer exists was orphaned by a server
  // restart. Optional for back-compat with records that predate it (those
  // fall back to record-age staleness).
  pid: z.number().int().positive().optional(),
  // POSIX workers spawn in their own process group so cancellation can stop
  // the complete CLI/shell descendant tree. Optional for legacy records.
  processGroupId: z.number().int().positive().optional(),
  // Provider-routing metadata. Optional for back-compat with older
  // records on disk that lack these fields.
  provider: ProviderId.optional(),
  providerVersion: z.string().optional(),
  model: z.string().optional(),
  modeId: z.string().optional(),
  resolvedFrom: ResolvedFrom.optional(),
  // Fallback-retry metadata, stamped by the runner when the worker emitted a
  // [FALLBACK] marker (the LLM call was retried on the fallback pair). When
  // present, `provider`/`model` above already reflect the pair that RAN;
  // `fallback.from` records the failed primary, `fallback.reason` the error
  // category that triggered the retry. Optional for back-compat.
  fallback: z
    .object({
      from: z.object({ provider: ProviderId, model: z.string() }),
      reason: z.string(),
    })
    .optional(),
  // Report-markdown normalizer fix log, attached after a report-writing job
  // finishes. Optional: only present on report-writing job types whose
  // output file was normalized post-generation.
  fixes: z.object({ count: z.number().int().nonnegative(), rules: z.array(z.string()) }).optional(),
});
export type JobRecord = z.infer<typeof JobRecord>;

export const JobCommand = z.object({
  cmd: z.string(),
  args: z.array(z.string()),
});
export type JobCommand = z.infer<typeof JobCommand>;
