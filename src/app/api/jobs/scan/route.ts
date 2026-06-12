export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { createJob, findActiveJob } from '@/lib/server/jobs';
import { rejectCrossOrigin } from '@/lib/server/same-origin';

export function POST(request: Request) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  try {
    // Symmetric conflict family (mirrors the scheduler + queue-screen guard):
    // scan, screen, screen-evaluate, and batch-evaluate all run screen.mjs +
    // merge-tracker over the same shared state (pipeline.md, screened-urls.txt,
    // tracker-additions/), so any one of them blocks a new scan.
    for (const kind of ['scan', 'screen', 'screen-evaluate', 'batch-evaluate']) {
      const active = findActiveJob(ROOT, kind);
      if (active) {
        return Response.json(
          { error: `a ${kind} is already running`, job: active },
          { status: 409 },
        );
      }
    }
    const job = createJob(ROOT, 'scan', {});
    return Response.json(job, { status: 202 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to start scan');
  }
}
