export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { UpdateJob } from '@/lib/schemas/update-job';
import { loadLatestActiveUpdateJob } from '@/lib/server/update-orchestrator';

export async function GET() {
  try {
    const persisted = loadLatestActiveUpdateJob(ROOT);
    if (!persisted) return Response.json({ job: null });
    const parsed = UpdateJob.safeParse(persisted);
    if (!parsed.success) return jsonError('Failed to load active update job', 500);
    return Response.json({ job: parsed.data });
  } catch {
    return jsonError('Failed to load active update job', 500);
  }
}
