export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { StartJobActionRequest } from '@/lib/schemas/chat-actions';
import { createConfirm, describeStartedJob, describeStartJob } from '@/lib/server/chat/confirms';
import { startChatJob } from '@/lib/server/chat/job-start';
import { JOB_KIND_BY_NUM } from '@/lib/server/jobs';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = StartJobActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid body', 400);
  }
  const { kind, params, terminalApproved } = parsed.data;

  // Fail fast on a malformed per-offer call so a doomed confirm card is
  // never shown (approval would only throw "missing or non-integer num").
  if (JOB_KIND_BY_NUM.has(kind) && !Number.isInteger(params?.num)) {
    return jsonError(`kind "${kind}" requires params.num (integer tracker number)`, 400);
  }

  const turnId = request.headers.get('x-sur9e-turn');
  const { summary, meta } = describeStartJob(ROOT, kind, params);

  // Web chat context: EVERY spend requires an explicit user click on the
  // confirm card — terminalApproved is deliberately ignored here.
  if (turnId) {
    const { token } = createConfirm(ROOT, {
      turnId,
      kind: 'start-job',
      payload: { kind, params },
      summary,
      meta,
    });
    return Response.json({ needsConfirm: true, token, summary, meta });
  }

  // Terminal context (no turn id): the human is at the keyboard. The
  // agent must ask them directly, then re-call with terminalApproved.
  if (terminalApproved !== true) {
    return Response.json({ needsConfirm: true, summary, meta });
  }

  try {
    const result = startChatJob(ROOT, kind, params);
    if ('conflict' in result) {
      return Response.json({ started: false, conflict: true, message: result.message });
    }
    return Response.json({
      started: true,
      job: result,
      ...describeStartedJob(kind, params, result),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'failed to start job', 400);
  }
}
