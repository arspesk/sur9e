import 'server-only';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobRecord, JobType } from '../../schemas/jobs';
import {
  WorkflowRecord,
  type WorkflowRecord as WorkflowRecordType,
  type WorkflowStep,
} from '../../schemas/workflows';
import { findByNum, normalizeStatus } from '../applications';
import { atomicWrite } from '../atomic-write';
import { getJob as getPersistedJob } from '../jobs/api';
import { cancelJob as cancelPersistedJob, persistJobRecord } from '../jobs/lifecycle';
import {
  findJobConflict,
  type JobConflictPayload,
  startJob as startPersistedJob,
} from '../jobs/start';
import { planWorkflow, type WorkflowPlan, type WorkflowTarget } from './planner';

type StartedJob =
  | JobRecord
  | { conflict: true; message: string; job?: JobRecord; setupRequired?: boolean };

const WORKFLOW_SINGLETON_MODES = new Set(['screen', 'scan', 'batch-evaluate']);

export interface WorkflowRuntimeDeps {
  offerExists: (num: number) => boolean;
  isEvaluated: (num: number) => boolean;
  startJob: (kind: string, params: Record<string, unknown>) => StartedJob;
  getJob: (id: string) => JobRecord | null;
  cancelJob: (id: string) => void;
}

export interface CreateWorkflowInput {
  targets: WorkflowTarget[];
  modes: string[];
  guidance?: string;
}

export interface CancelWorkflowResult {
  cancelled: boolean;
  workflow: WorkflowRecordType;
}

const TERMINAL_WORKFLOW_STATUSES = new Set<WorkflowRecordType['status']>([
  'done',
  'partial',
  'error',
  'cancelled',
]);

export function isWorkflowTerminal(status: WorkflowRecordType['status']): boolean {
  return TERMINAL_WORKFLOW_STATUSES.has(status);
}

function workflowsDir(root: string): string {
  return join(root, 'data', 'workflows');
}

function workflowPath(root: string, id: string): string {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('invalid workflow id');
  return join(workflowsDir(root), `${id}.json`);
}

function persist(root: string, workflow: WorkflowRecordType): void {
  mkdirSync(workflowsDir(root), { recursive: true });
  atomicWrite(workflowPath(root, workflow.id), JSON.stringify(workflow, null, 2));
}

function defaultDeps(root: string): WorkflowRuntimeDeps {
  return {
    offerExists: num => Boolean(findByNum(root, num)),
    isEvaluated: num => {
      const row = findByNum(root, num);
      if (!row?.reportPath) return false;
      return !['screened', 'discarded'].includes(normalizeStatus(row.status));
    },
    startJob: (kind, params) =>
      startPersistedJob(root, { kind: kind as JobType, params }) as StartedJob,
    getJob: id => getPersistedJob(root, id),
    cancelJob: id => {
      cancelPersistedJob(root, id);
    },
  };
}

export function getWorkflow(root: string, id: string): WorkflowRecordType | null {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const path = workflowPath(root, id);
  if (!existsSync(path)) return null;
  try {
    return WorkflowRecord.parse(JSON.parse(readFileSync(path, 'utf-8')));
  } catch {
    return null;
  }
}

export function planWorkflowForTargets(
  root: string,
  input: CreateWorkflowInput,
  providedDeps?: WorkflowRuntimeDeps,
  options: { allowMissingOfferNums?: ReadonlySet<number> } = {},
): WorkflowPlan {
  const deps = providedDeps ?? defaultDeps(root);
  for (const target of input.targets) {
    if (
      'num' in target &&
      typeof target.num === 'number' &&
      !('url' in target) &&
      !options.allowMissingOfferNums?.has(target.num) &&
      !deps.offerExists(target.num)
    ) {
      throw new Error(`num not found: ${target.num}`);
    }
  }
  const evaluatedOfferNums = new Set(
    input.targets.flatMap(target =>
      'num' in target &&
      typeof target.num === 'number' &&
      Number.isInteger(target.num) &&
      deps.isEvaluated(target.num)
        ? [target.num]
        : [],
    ),
  );
  return planWorkflow({
    targets: input.targets,
    modes: input.modes,
    evaluatedOfferNums,
  });
}

export function workflowChildJobs(
  root: string,
  workflow: WorkflowRecordType,
  providedDeps?: Pick<WorkflowRuntimeDeps, 'getJob'>,
): JobRecord[] {
  const getJob = providedDeps?.getJob ?? ((id: string) => getPersistedJob(root, id));
  return workflow.steps.flatMap(step => {
    if (!step.jobId) return [];
    const job = getJob(step.jobId);
    return job ? [job] : [];
  });
}

export function listWorkflows(root: string): WorkflowRecordType[] {
  const dir = workflowsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .flatMap(name => {
      try {
        return [
          WorkflowRecord.parse(JSON.parse(readFileSync(join(dir, name), 'utf-8'))),
        ] as WorkflowRecordType[];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function resolveStepParams(
  workflow: WorkflowRecordType,
  step: WorkflowStep,
): Record<string, unknown> {
  const target = step.targetIndex === null ? null : workflow.targets[step.targetIndex];
  const params = { ...step.params };
  if (target && 'num' in target && Number.isInteger(target.num) && step.mode !== 'screen') {
    params.num = target.num;
    delete params.url;
  } else if (target && 'num' in target && Number.isInteger(target.num) && !('url' in target)) {
    params.num = target.num;
  }
  if (workflow.guidance) params.guidance = workflow.guidance;
  params.workflow_id = workflow.id;
  params.workflow_step_id = step.id;
  return params;
}

function hasBadDependency(step: WorkflowStep, byId: Map<string, WorkflowStep>): boolean {
  return step.dependsOn.some(id => {
    const dependency = byId.get(id);
    return (
      !dependency ||
      dependency.status === 'error' ||
      dependency.status === 'cancelled' ||
      dependency.status === 'skipped'
    );
  });
}

function allDependenciesDone(step: WorkflowStep, byId: Map<string, WorkflowStep>): boolean {
  return step.dependsOn.every(id => byId.get(id)?.status === 'done');
}

function deriveStatus(workflow: WorkflowRecordType): WorkflowRecordType['status'] {
  if (workflow.status === 'cancelled') return 'cancelled';
  const statuses = workflow.steps.map(step => step.status);
  if (statuses.some(status => status === 'running')) return 'running';
  if (statuses.some(status => status === 'queued' || status === 'blocked')) return 'queued';
  const bad = statuses.some(status => ['error', 'cancelled', 'skipped'].includes(status));
  const done = statuses.some(status => status === 'done');
  if (bad && done) return 'partial';
  if (bad) return 'error';
  return 'done';
}

function sameActiveJob(step: Pick<WorkflowStep, 'mode' | 'params'>, job: JobRecord): boolean {
  if (job.type !== step.mode) return false;
  const expectedNum = step.params.num;
  const expectedUrl = step.params.url;
  const expectedQueue = step.params.queue;
  return (
    (expectedNum === undefined || job.params.num === expectedNum) &&
    (expectedUrl === undefined || job.params.url === expectedUrl) &&
    (expectedQueue === undefined || job.params.queue === expectedQueue)
  );
}

/** Reject an incompatible already-running singleton before confirmation.
 * Identical active jobs are intentionally allowed: approval attaches the
 * workflow step to that existing record instead of spending twice. */
export function assertWorkflowStartable(
  root: string,
  plan: WorkflowPlan,
  inspect: (
    rootPath: string,
    kind: JobType,
    params: Record<string, unknown>,
  ) => JobConflictPayload | null = findJobConflict,
): void {
  const inspectedSingletons = new Set<string>();
  for (const step of plan.steps) {
    if (step.dependsOn.length > 0) continue;
    if (WORKFLOW_SINGLETON_MODES.has(step.mode)) {
      if (inspectedSingletons.has(step.mode)) continue;
      inspectedSingletons.add(step.mode);
    }
    const conflict = inspect(root, step.mode as JobType, step.params);
    if (conflict && !sameActiveJob(step, conflict.job)) {
      throw new Error(conflict.message);
    }
  }
}

export function advanceWorkflow(
  root: string,
  id: string,
  providedDeps?: WorkflowRuntimeDeps,
): WorkflowRecordType {
  const deps = providedDeps ?? defaultDeps(root);
  const stored = getWorkflow(root, id);
  if (!stored) throw new Error(`workflow not found: ${id}`);
  if (isWorkflowTerminal(stored.status)) return stored;

  const workflow: WorkflowRecordType = {
    ...stored,
    targets: stored.targets.map(target => ({ ...target })),
    steps: stored.steps.map(step => ({
      ...step,
      dependsOn: [...step.dependsOn],
      params: { ...step.params },
    })),
  };

  for (const step of workflow.steps) {
    if (step.status !== 'running' || !step.jobId) continue;
    const job = deps.getJob(step.jobId);
    if (!job) {
      step.status = 'error';
      step.error = 'child job record is missing';
      continue;
    }
    if (job.status === 'queued' || job.status === 'running') continue;
    step.status = job.status === 'done' ? 'done' : job.status;
    step.error = job.error;
    if (
      step.mode === 'screen' &&
      step.status === 'done' &&
      step.targetIndex !== null &&
      Number.isInteger(job.params.num)
    ) {
      const target = workflow.targets[step.targetIndex];
      if (target && 'url' in target) {
        workflow.targets[step.targetIndex] = { ...target, num: job.params.num as number };
      }
    }
  }

  const byId = new Map(workflow.steps.map(step => [step.id, step]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of workflow.steps) {
      if (step.status !== 'blocked' && step.status !== 'queued') continue;
      if (hasBadDependency(step, byId)) {
        step.status = 'skipped';
        step.error = 'prerequisite did not complete';
        changed = true;
      } else if (step.status === 'blocked' && allDependenciesDone(step, byId)) {
        step.status = 'queued';
        changed = true;
      }
    }
  }

  let active = workflow.steps.filter(step => step.status === 'running').length;
  const activeSingletons = new Set(
    workflow.steps
      .filter(step => step.status === 'running' && WORKFLOW_SINGLETON_MODES.has(step.mode))
      .map(step => step.mode),
  );
  for (const step of workflow.steps) {
    if (active >= workflow.maxParallel || step.status !== 'queued') continue;
    if (WORKFLOW_SINGLETON_MODES.has(step.mode) && activeSingletons.has(step.mode)) continue;
    const params = resolveStepParams(workflow, step);
    const result = deps.startJob(step.mode, params);
    if ('conflict' in result) {
      if (result.job && sameActiveJob({ ...step, params }, result.job)) {
        if (!result.job.workflowId) {
          persistJobRecord(root, {
            ...result.job,
            workflowId: workflow.id,
            workflowStepId: step.id,
            params: {
              ...result.job.params,
              workflow_id: workflow.id,
              workflow_step_id: step.id,
            },
          });
        }
        step.jobId = result.job.id;
        step.status = 'running';
        active += 1;
        if (WORKFLOW_SINGLETON_MODES.has(step.mode)) activeSingletons.add(step.mode);
      } else {
        step.status = 'error';
        step.error = result.message;
      }
      continue;
    }
    step.jobId = result.id;
    step.status = 'running';
    active += 1;
    if (WORKFLOW_SINGLETON_MODES.has(step.mode)) activeSingletons.add(step.mode);
  }

  workflow.status = deriveStatus(workflow);
  workflow.updatedAt = new Date().toISOString();
  workflow.finishedAt = isWorkflowTerminal(workflow.status) ? workflow.updatedAt : null;
  persist(root, workflow);
  return workflow;
}

export function createWorkflow(
  root: string,
  input: CreateWorkflowInput,
  providedDeps?: WorkflowRuntimeDeps,
): WorkflowRecordType {
  const deps = providedDeps ?? defaultDeps(root);
  const plan = planWorkflowForTargets(root, input, deps);
  const now = new Date().toISOString();
  const workflow = WorkflowRecord.parse({
    id: randomBytes(8).toString('hex'),
    status: 'queued',
    targets: plan.targets,
    requestedModes: plan.requestedModes,
    guidance: input.guidance,
    maxParallel: plan.maxParallel,
    steps: plan.steps.map(step => ({
      ...step,
      status: step.dependsOn.length > 0 ? 'blocked' : 'queued',
      error: null,
    })),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  });
  persist(root, workflow);
  return advanceWorkflow(root, workflow.id, deps);
}

export function cancelWorkflow(
  root: string,
  id: string,
  providedDeps?: WorkflowRuntimeDeps,
): CancelWorkflowResult {
  const deps = providedDeps ?? defaultDeps(root);
  const workflow = getWorkflow(root, id);
  if (!workflow) throw new Error(`workflow not found: ${id}`);
  if (isWorkflowTerminal(workflow.status)) return { cancelled: false, workflow };
  for (const step of workflow.steps) {
    if (step.status === 'running' && step.jobId) deps.cancelJob(step.jobId);
    if (['running', 'queued', 'blocked'].includes(step.status)) {
      step.status = 'cancelled';
      step.error = null;
    }
  }
  workflow.status = 'cancelled';
  workflow.updatedAt = new Date().toISOString();
  workflow.finishedAt = workflow.updatedAt;
  persist(root, workflow);
  return { cancelled: true, workflow };
}

export function advanceWorkflowsForJob(
  root: string,
  jobId: string,
  deps?: WorkflowRuntimeDeps,
): WorkflowRecordType[] {
  return listWorkflows(root)
    .filter(workflow => workflow.steps.some(step => step.jobId === jobId))
    .map(workflow => advanceWorkflow(root, workflow.id, deps));
}

export function reconcileWorkflows(root: string, deps?: WorkflowRuntimeDeps): WorkflowRecordType[] {
  return listWorkflows(root)
    .filter(workflow => workflow.status === 'queued' || workflow.status === 'running')
    .map(workflow => advanceWorkflow(root, workflow.id, deps));
}
