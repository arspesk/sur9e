export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { createJob, findActiveJob } from '@/lib/server/jobs';
import { rejectCrossOrigin } from '@/lib/server/same-origin';

export async function POST(request: Request) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  try {
    // Same conflict family as the scan route / startJobAction: all four kinds
    // run the screen.mjs + merge-tracker chain over shared unlocked state.
    for (const kind of ['scan', 'screen', 'screen-evaluate', 'batch-evaluate']) {
      const active = findActiveJob(ROOT, kind);
      if (active) {
        return Response.json(
          { error: `a ${kind} is already running`, job: active },
          { status: 409 },
        );
      }
    }
    const body = await request.json().catch(() => ({}));
    const parallel = Number.isInteger(body?.parallel) ? body.parallel : 4;
    const minScore = Number.isFinite(body?.min_score) ? body.min_score : 3;
    const job = createJob(ROOT, 'batch-evaluate', { parallel, min_score: minScore });
    return Response.json(job, { status: 202 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to start batch-evaluate');
  }
}
