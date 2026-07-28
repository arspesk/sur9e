export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { CancelJobActionRequest } from '@/lib/schemas/chat-actions';
import { createConfirm, describeCancelJob } from '@/lib/server/chat/confirms';
import { cancelJob, getJob } from '@/lib/server/jobs';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = CancelJobActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid body', 400);
  }
  const { jobId, terminalApproved } = parsed.data;
  const job = getJob(ROOT, jobId);
  if (!job) return jsonError(`job not found: ${jobId}`, 404);
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    return Response.json({ cancelled: false, job });
  }

  const turnId = request.headers.get('x-sur9e-turn');
  const { summary, meta } = describeCancelJob(job);
  if (turnId) {
    const { token } = createConfirm(ROOT, {
      turnId,
      kind: 'cancel-job',
      payload: { jobId },
      summary,
      meta,
    });
    return Response.json({ needsConfirm: true, token, summary, meta });
  }
  if (terminalApproved !== true) {
    return Response.json({ needsConfirm: true, summary, meta });
  }

  try {
    return Response.json(cancelJob(ROOT, jobId));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'failed to cancel job', 400);
  }
}
