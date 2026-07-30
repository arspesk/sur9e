export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { StartWorkflowActionRequest } from '@/lib/schemas/chat-actions';
import { findByNum, normalizeStatus } from '@/lib/server/applications';
import {
  createConfirm,
  describeStartedWorkflow,
  describeStartWorkflow,
} from '@/lib/server/chat/confirms';
import { getJob } from '@/lib/server/jobs';
import { assertWorkflowStartable, createWorkflow, planWorkflow } from '@/lib/server/workflows';

function validatePlan(targets: Array<{ num: number } | { url: string }>, modes: string[]) {
  const evaluated = new Set<number>();
  for (const target of targets) {
    if (!('num' in target)) continue;
    const row = findByNum(ROOT, target.num);
    if (!row) throw new Error(`num not found: ${target.num}`);
    if (row.reportPath && !['screened', 'discarded'].includes(normalizeStatus(row.status))) {
      evaluated.add(target.num);
    }
  }
  return planWorkflow({ targets, modes, evaluatedOfferNums: evaluated });
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = StartWorkflowActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid body', 400);
  }
  const { terminalApproved, ...input } = parsed.data;
  try {
    const plan = validatePlan(input.targets, input.modes);
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
    const jobs = workflow.steps.flatMap(step => {
      if (!step.jobId) return [];
      const job = getJob(ROOT, step.jobId);
      return job ? [job] : [];
    });
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
