import { z } from 'zod';

export const UPDATE_JOB_PHASES = [
  'queued',
  'applying',
  'stopping',
  'rebuilding',
  'restarting',
  'verifying',
  'recovering',
  'recovery-queued',
  'succeeded',
  'rolled-back',
  'failed',
] as const;

export const UpdateJobPhase = z.enum(UPDATE_JOB_PHASES);
export type UpdateJobPhase = z.infer<typeof UpdateJobPhase>;

export const UpdateJobLaunchState = z.enum(['claim-pending', 'owned']);
export type UpdateJobLaunchState = z.infer<typeof UpdateJobLaunchState>;

export const UpdateJobId = z.uuid();

const ACTIVE_WORKER_PHASES = new Set<UpdateJobPhase>([
  'applying',
  'stopping',
  'rebuilding',
  'restarting',
  'verifying',
  'recovering',
]);

export const UpdateJobCheckpoint = z.enum([
  'apply-started',
  'applied',
  'server-stopped',
  'server-restarted',
  'rollback-complete',
  'dependencies-restored',
  'recovery-build-complete',
  'recovery-server-started',
]);

export const UpdateJob = z
  .object({
    id: UpdateJobId,
    phase: UpdateJobPhase,
    mode: z
      .object({
        prod: z.boolean(),
        tailscale: z.boolean(),
      })
      .strict(),
    fromVersion: z.string(),
    toVersion: z.string().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    error: z.string().optional(),
    pid: z.number().int().positive().optional(),
    launchState: UpdateJobLaunchState.optional(),
    checkpoint: UpdateJobCheckpoint.optional(),
  })
  .strict()
  .superRefine((job, context) => {
    if (
      ACTIVE_WORKER_PHASES.has(job.phase) &&
      (job.launchState !== 'owned' || job.pid === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['launchState'],
        message: 'active update jobs require owned worker metadata',
      });
    }
    if (job.launchState === 'owned' && job.pid === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['pid'],
        message: 'owned update jobs require a worker pid',
      });
    }
  });
export type UpdateJob = z.infer<typeof UpdateJob>;
