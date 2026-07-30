import { z } from 'zod';
import { HttpUrl } from './urls';

export const WorkflowStatus = z.enum([
  'queued',
  'running',
  'done',
  'partial',
  'error',
  'cancelled',
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const WorkflowStepStatus = z.enum([
  'blocked',
  'queued',
  'running',
  'done',
  'error',
  'cancelled',
  'skipped',
]);
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatus>;

export const WorkflowTarget = z.union([
  z
    .object({
      url: HttpUrl,
      num: z.number().int().positive().optional(),
    })
    .strict(),
  z.object({ num: z.number().int().positive() }).strict(),
]);
export type WorkflowTarget = z.infer<typeof WorkflowTarget>;

export const WorkflowStep = z.object({
  id: z.string().min(1),
  targetIndex: z.number().int().nonnegative().nullable(),
  mode: z.string().min(1),
  dependsOn: z.array(z.string()),
  params: z.record(z.string(), z.unknown()),
  status: WorkflowStepStatus,
  jobId: z.string().optional(),
  error: z.string().nullable().default(null),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const WorkflowRecord = z.object({
  id: z.string().regex(/^[a-f0-9]{16}$/),
  status: WorkflowStatus,
  targets: z.array(WorkflowTarget),
  requestedModes: z.array(z.string().min(1)),
  guidance: z.string().optional(),
  maxParallel: z.number().int().positive().max(4),
  steps: z.array(WorkflowStep),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type WorkflowRecord = z.infer<typeof WorkflowRecord>;
