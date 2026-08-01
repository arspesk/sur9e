import { z } from 'zod';

export const UPDATE_JOB_PHASES = [
  'queued',
  'applying',
  'stopping',
  'rebuilding',
  'restarting',
  'verifying',
  'recovering',
  'succeeded',
  'rolled-back',
  'failed',
] as const;

export const UpdateJobPhase = z.enum(UPDATE_JOB_PHASES);
export type UpdateJobPhase = z.infer<typeof UpdateJobPhase>;

export const UpdateJobLaunchState = z.enum(['ownership-unknown', 'owned']);
export type UpdateJobLaunchState = z.infer<typeof UpdateJobLaunchState>;

export const UpdateJob = z
  .object({
    id: z.string().uuid(),
    phase: UpdateJobPhase,
    mode: z
      .object({
        prod: z.boolean(),
        tailscale: z.boolean(),
      })
      .strict(),
    fromVersion: z.string(),
    toVersion: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    error: z.string().optional(),
    pid: z.number().int().positive().optional(),
    launchState: UpdateJobLaunchState.optional(),
  })
  .strict();
export type UpdateJob = z.infer<typeof UpdateJob>;
