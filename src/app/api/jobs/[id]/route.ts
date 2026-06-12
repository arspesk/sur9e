export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { getJob } from '@/lib/server/jobs';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return jsonError('Invalid job id', 400);
  const job = getJob(ROOT, id);
  if (!job) return jsonError('Job not found', 404);
  return Response.json(job);
}
