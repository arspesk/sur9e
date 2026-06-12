export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { createJob, findActiveJob } from '@/lib/server/jobs';
import { rejectCrossOrigin } from '@/lib/server/same-origin';

export async function POST(request: Request) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const body = await request.json().catch(() => null);
  const url = body?.url;
  // Queue mode screens the WHOLE pending pipeline (screen.mjs + merge) and
  // must be opted into EXPLICITLY with `queue: true` — never inferred from a
  // missing/empty body, so negative-fuzzing this endpoint can't silently
  // spawn a real background job. An explicit url screens just that offer.
  const queueMode = body?.queue === true;
  if (queueMode) {
    if (url != null && (typeof url !== 'string' || !/^https?:\/\//.test(url))) {
      return jsonError('url must start with http(s)://', 400);
    }
  } else if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return jsonError(
      'provide a url (http(s)://...), or set queue:true to screen the whole pending pipeline',
      400,
    );
  }
  // Singleton guard: screen.mjs + merge-tracker share state
  // (pipeline.md, applications.md, screened-urls.txt, tracker-additions/)
  // with no per-call locking. Concurrent screen jobs each see the same
  // pending URLs and race on the merge-tracker rename. Reject the second
  // caller with HTTP 409 + a conflict payload pointing at the active job.
  // screen-evaluate runs the same add-to-pipeline → screen.mjs → merge-tracker
  // chain, so it conflicts in BOTH modes (mirrors startJobAction). Queue mode
  // also conflicts with the scan/batch-evaluate family — they run the same
  // screen.mjs over the same files.
  const conflictKinds = queueMode
    ? ['screen', 'screen-evaluate', 'scan', 'batch-evaluate']
    : ['screen', 'screen-evaluate'];
  for (const kind of conflictKinds) {
    const active = findActiveJob(ROOT, kind);
    if (active) {
      return Response.json(
        { conflict: true, message: `a ${kind} is already running`, job: active },
        { status: 409 },
      );
    }
  }
  try {
    // Forward optional per-job runtime override — present for
    // API compatibility with evaluate/outreach endpoints, but note that
    // batch/screen.mjs still hard-rejects non-Claude providers, so an
    // override targeting codex/opencode will fail at the
    // screen worker boundary even though the runner stamps it correctly.
    const params: Record<string, unknown> = queueMode ? { queue: true } : { url };
    if (typeof body?.platform === 'string' && body.platform) params.platform = body.platform;
    if (typeof body?.model === 'string' && body.model) params.model = body.model;
    const job = createJob(ROOT, 'screen', params);
    return Response.json(job, { status: 202 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to start screen');
  }
}
