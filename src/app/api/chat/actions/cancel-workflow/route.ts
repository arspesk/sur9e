export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { CancelWorkflowActionRequest } from '@/lib/schemas/chat-actions';
import { createConfirm, describeCancelWorkflow } from '@/lib/server/chat/confirms';
import { cancelWorkflow, getWorkflow } from '@/lib/server/workflows';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = CancelWorkflowActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid body', 400);
  }
  const { workflowId, terminalApproved } = parsed.data;
  const workflow = getWorkflow(ROOT, workflowId);
  if (!workflow) return jsonError(`workflow not found: ${workflowId}`, 404);
  if (['done', 'partial', 'error', 'cancelled'].includes(workflow.status)) {
    return Response.json({ cancelled: false, workflow });
  }
  const { summary, meta } = describeCancelWorkflow(workflow);
  const turnId = request.headers.get('x-sur9e-turn');
  if (turnId) {
    const { token } = createConfirm(ROOT, {
      turnId,
      kind: 'cancel-workflow',
      payload: { workflowId },
      summary,
      meta,
    });
    return Response.json({ needsConfirm: true, token, summary, meta });
  }
  if (terminalApproved !== true) {
    return Response.json({ needsConfirm: true, summary, meta });
  }
  try {
    return Response.json({ cancelled: true, workflow: cancelWorkflow(ROOT, workflowId) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'failed to cancel workflow', 400);
  }
}
