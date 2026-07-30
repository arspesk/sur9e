export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { advanceWorkflow, getWorkflow } from '@/lib/server/workflows';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const workflow = getWorkflow(ROOT, id);
  if (!workflow) return jsonError(`workflow not found: ${id}`, 404);
  return Response.json(
    workflow.status === 'queued' || workflow.status === 'running'
      ? advanceWorkflow(ROOT, id)
      : workflow,
  );
}
