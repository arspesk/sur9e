export const runtime = 'nodejs';

import { z } from 'zod';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { UpdateJob } from '@/lib/schemas/update-job';
import { reconcileUpdateJob } from '@/lib/server/update-orchestrator';

interface Params {
  params: Promise<{ id: string }>;
}

const UpdateJobId = z.string().uuid();

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!UpdateJobId.safeParse(id).success) return jsonError('Invalid update job id', 400);

  try {
    const persisted = reconcileUpdateJob(ROOT, id);
    if (!persisted) return jsonError('Update job not found', 404);
    const parsed = UpdateJob.safeParse(persisted);
    if (!parsed.success) return jsonError('Failed to load update job', 500);
    return Response.json(parsed.data);
  } catch {
    return jsonError('Failed to load update job', 500);
  }
}
