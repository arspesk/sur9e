import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { findByNum } from '@/lib/server/applications';
import { createJob } from '@/lib/server/jobs';
import { rejectCrossOrigin } from '@/lib/server/same-origin';

export async function startJobByNum(type: string, request: Request) {
  // All per-num job routes spawn token-spending AI runs — block cross-site
  // "simple request" POSTs the same way the scan/screen/update routes do.
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const body = await request.json().catch(() => null);
  const num = body?.num;
  if (!Number.isInteger(num)) return jsonError('missing or non-integer num', 400);
  try {
    if (!findByNum(ROOT, num)) return jsonError(`num not found: ${num}`, 404);
    // Forward optional per-job runtime override — when the caller embeds
    // `platform` + `model`, runner.ts and command-registry pick them up as
    // Level-1 runOverride.
    const params: Record<string, unknown> = { num };
    if (typeof body?.platform === 'string' && body.platform) params.platform = body.platform;
    if (typeof body?.model === 'string' && body.model) params.model = body.model;
    const job = createJob(ROOT, type, params);
    // Every generator-mode spawn route returns `markdown: ''` so the
    // mode-completion contract is satisfied at spawn time. The body chunk
    // actually materializes later via the job's terminal JobSnapshot — this
    // spawn response can't carry it because the job runs asynchronously.
    // TODO: wire mode templates to emit a markdown chunk into the
    // snapshot, then forward it through useJobAction → onDone({ markdown }).
    return Response.json({ ...job, markdown: '' }, { status: 202 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : `Failed to start ${type}`);
  }
}
