export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { UpdateJob, UpdateJobId } from '@/lib/schemas/update-job';
import { rejectCrossOrigin } from '@/lib/server/same-origin';
import { loadUpdateJob, reconcileUpdateJob } from '@/lib/server/update-orchestrator';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!UpdateJobId.safeParse(id).success) return jsonError('Invalid update job id', 400);

  try {
    const persisted = loadUpdateJob(ROOT, id);
    if (!persisted) return jsonError('Update job not found', 404);
    const parsed = UpdateJob.safeParse(persisted);
    if (!parsed.success) return jsonError('Failed to load update job', 500);
    return Response.json(parsed.data);
  } catch {
    return jsonError('Failed to load update job', 500);
  }
}

export async function POST(request: Request, { params }: Params) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;

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
