import { z } from 'zod';

export const PipelineEntry = z.object({
  url: z.string().url(),
  company: z.string().default(''),
  role: z.string().default(''),
});
export type PipelineEntry = z.infer<typeof PipelineEntry>;

export const PipelineResult = z.object({ pending: z.array(PipelineEntry) });
export type PipelineResult = z.infer<typeof PipelineResult>;
