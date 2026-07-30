export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { StartWorkflowActionRequest } from '@/lib/schemas/chat-actions';
import {
  createConfirm,
  describeStartedWorkflow,
  describeStartWorkflow,
} from '@/lib/server/chat/confirms';
import {
  assertWorkflowStartable,
  createWorkflow,
  planWorkflowForTargets,
  workflowChildJobs,
} from '@/lib/server/workflows';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = StartWorkflowActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid body', 400);
  }
  const { terminalApproved, ...input } = parsed.data;
  try {
    const plan = planWorkflowForTargets(ROOT, input);
    assertWorkflowStartable(ROOT, plan);
    const { summary, meta } = describeStartWorkflow(input, plan);
    const turnId = request.headers.get('x-sur9e-turn');
    if (turnId) {
      const { token } = createConfirm(ROOT, {
        turnId,
        kind: 'start-workflow',
        payload: input,
        summary,
        meta,
      });
      return Response.json({ needsConfirm: true, token, summary, meta });
    }
    if (terminalApproved !== true) {
      return Response.json({ needsConfirm: true, summary, meta });
    }
    const workflow = createWorkflow(ROOT, input);
    const jobs = workflowChildJobs(ROOT, workflow);
    return Response.json({
      started: true,
      workflow,
      jobs,
      ...describeStartedWorkflow(workflow),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'failed to start workflow', 400);
  }
}
