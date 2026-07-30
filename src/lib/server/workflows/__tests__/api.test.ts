import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobRecord } from '../../../schemas/jobs';
import {
  advanceWorkflow,
  assertWorkflowStartable,
  cancelWorkflow,
  createWorkflow,
  getWorkflow,
  type WorkflowRuntimeDeps,
} from '../api';
import { planWorkflow } from '../planner';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'sur9e-workflow-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

function harness() {
  const jobs = new Map<string, JobRecord>();
  let nextId = 0;
  const starts: JobRecord[] = [];
  const cancellations: string[] = [];
  const deps: WorkflowRuntimeDeps = {
    offerExists: () => true,
    isEvaluated: () => false,
    startJob: (kind, params) => {
      const job = {
        id: String(++nextId).padStart(16, '0'),
        type: kind,
        status: 'queued',
        params,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        output: '',
        error: null,
        exitCode: null,
      } as JobRecord;
      jobs.set(job.id, job);
      starts.push(job);
      return job;
    },
    getJob: id => jobs.get(id) ?? null,
    cancelJob: id => {
      cancellations.push(id);
      const job = jobs.get(id);
      if (job) jobs.set(id, { ...job, status: 'cancelled', finishedAt: new Date().toISOString() });
    },
  };
  return { jobs, starts, cancellations, deps };
}

describe('workflow persistence and execution', () => {
  it('rejects an incompatible singleton before confirmation but permits exact reuse', () => {
    const repo = root();
    const plan = planWorkflow({
      targets: [{ url: 'https://example.com/jobs/1' }],
      modes: ['screen'],
      evaluatedOfferNums: new Set(),
    });
    const active = {
      id: 'existing-job-001',
      type: 'screen',
      status: 'running',
      params: { url: 'https://example.com/jobs/1' },
      startedAt: new Date().toISOString(),
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    } as JobRecord;
    const inspect = () => ({
      conflict: true as const,
      message: 'a screen is already running',
      job: active,
    });

    expect(() => assertWorkflowStartable(repo, plan, inspect)).not.toThrow();
    expect(() =>
      assertWorkflowStartable(repo, plan, () => ({
        ...inspect(),
        job: {
          ...active,
          params: { url: 'https://example.com/jobs/other' },
        },
      })),
    ).toThrow('a screen is already running');
  });

  it('persists and starts only the first step of a sequential workflow', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(
      repo,
      { targets: [{ num: 12 }], modes: ['screen-evaluate'] },
      h.deps,
    );

    expect(h.starts.map(job => job.type)).toEqual(['screen']);
    expect(workflow.steps.map(step => step.status)).toEqual(['running', 'blocked']);
    expect(
      JSON.parse(readFileSync(join(repo, 'data/workflows', `${workflow.id}.json`), 'utf-8')),
    ).toMatchObject({ id: workflow.id, status: 'running' });
  });

  it('starts the dependent evaluation after screening resolves', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(
      repo,
      { targets: [{ url: 'https://example.com/jobs/1' }], modes: ['screen-evaluate'] },
      h.deps,
    );
    const screen = h.starts[0] as JobRecord;
    h.jobs.set(screen.id, {
      ...screen,
      status: 'done',
      params: { ...screen.params, num: 44 },
      finishedAt: new Date().toISOString(),
    });

    const advanced = advanceWorkflow(repo, workflow.id, h.deps);

    expect(h.starts.map(job => job.type)).toEqual(['screen', 'evaluate']);
    expect(h.starts[1]?.params).toMatchObject({ num: 44 });
    expect(advanced.targets[0]).toMatchObject({ url: 'https://example.com/jobs/1', num: 44 });
  });

  it('limits selected-offer bulk work to four active children', () => {
    const repo = root();
    const h = harness();
    createWorkflow(
      repo,
      {
        targets: [{ num: 1 }, { num: 2 }, { num: 3 }, { num: 4 }, { num: 5 }],
        modes: ['evaluate'],
      },
      h.deps,
    );

    expect(h.starts).toHaveLength(4);
  });

  it('serializes singleton screening across URL targets without coupling their failure branches', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(
      repo,
      {
        targets: [{ url: 'https://example.com/jobs/1' }, { url: 'https://example.com/jobs/2' }],
        modes: ['screen-evaluate'],
      },
      h.deps,
    );

    expect(h.starts.map(job => job.type)).toEqual(['screen']);
    const first = h.starts[0] as JobRecord;
    h.jobs.set(first.id, {
      ...first,
      status: 'error',
      error: 'unreachable',
      finishedAt: new Date().toISOString(),
    });

    const advanced = advanceWorkflow(repo, workflow.id, h.deps);

    expect(h.starts.map(job => job.type)).toEqual(['screen', 'screen']);
    expect(
      advanced.steps.find(step => step.targetIndex === 0 && step.mode === 'evaluate')?.status,
    ).toBe('skipped');
    expect(
      advanced.steps.find(step => step.targetIndex === 1 && step.mode === 'screen')?.status,
    ).toBe('running');
  });

  it('starts the next independent child when a concurrency slot becomes available', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(
      repo,
      {
        targets: [{ num: 1 }, { num: 2 }, { num: 3 }, { num: 4 }, { num: 5 }],
        modes: ['evaluate'],
      },
      h.deps,
    );
    const first = h.starts[0] as JobRecord;
    h.jobs.set(first.id, {
      ...first,
      status: 'done',
      finishedAt: new Date().toISOString(),
    });

    advanceWorkflow(repo, workflow.id, h.deps);

    expect(h.starts).toHaveLength(5);
  });

  it('reattaches an identical active job instead of starting a duplicate', () => {
    const repo = root();
    const h = harness();
    const active = {
      id: 'existing-job-001',
      type: 'evaluate',
      status: 'running',
      params: { num: 12 },
      startedAt: new Date().toISOString(),
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    } as JobRecord;
    h.jobs.set(active.id, active);
    h.deps.startJob = () => ({
      conflict: true,
      message: 'already running',
      job: active,
    });

    const workflow = createWorkflow(repo, { targets: [{ num: 12 }], modes: ['evaluate'] }, h.deps);

    expect(workflow.status).toBe('running');
    expect(workflow.steps[0]).toMatchObject({ status: 'running', jobId: active.id });
    expect(
      JSON.parse(readFileSync(join(repo, 'data/jobs', `${active.id}.json`), 'utf-8')),
    ).toMatchObject({
      workflowId: workflow.id,
      workflowStepId: workflow.steps[0]?.id,
      params: {
        workflow_id: workflow.id,
        workflow_step_id: workflow.steps[0]?.id,
      },
    });
  });

  it('marks an incompatible active-job conflict as an error', () => {
    const repo = root();
    const h = harness();
    const active = {
      id: 'existing-job-001',
      type: 'screen',
      status: 'running',
      params: { url: 'https://example.com/other' },
      startedAt: new Date().toISOString(),
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    } as JobRecord;
    h.deps.startJob = () => ({
      conflict: true,
      message: 'a screen is already running',
      job: active,
    });

    const workflow = createWorkflow(
      repo,
      { targets: [{ url: 'https://example.com/jobs/1' }], modes: ['screen'] },
      h.deps,
    );

    expect(workflow.status).toBe('error');
    expect(workflow.steps[0]).toMatchObject({
      status: 'error',
      error: 'a screen is already running',
    });
  });

  it('isolates a failed branch and continues another offer', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(
      repo,
      {
        targets: [{ num: 1 }, { num: 2 }],
        modes: ['evaluate', 'cover-letter'],
      },
      h.deps,
    );
    const [first, second] = h.starts;
    h.jobs.set(first?.id as string, {
      ...(first as JobRecord),
      status: 'error',
      error: 'failed',
      finishedAt: new Date().toISOString(),
    });
    h.jobs.set(second?.id as string, {
      ...(second as JobRecord),
      status: 'done',
      finishedAt: new Date().toISOString(),
    });

    const advanced = advanceWorkflow(repo, workflow.id, h.deps);

    expect(
      advanced.steps.find(step => step.targetIndex === 0 && step.mode === 'cover-letter')?.status,
    ).toBe('skipped');
    expect(
      advanced.steps.find(step => step.targetIndex === 1 && step.mode === 'cover-letter')?.status,
    ).toBe('running');
  });

  it('finishes partial after one offer branch fails and another completes', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(
      repo,
      {
        targets: [{ num: 1 }, { num: 2 }],
        modes: ['evaluate', 'cover-letter'],
      },
      h.deps,
    );
    const [first, second] = h.starts as [JobRecord, JobRecord];
    h.jobs.set(first.id, {
      ...first,
      status: 'error',
      error: 'failed',
      finishedAt: new Date().toISOString(),
    });
    h.jobs.set(second.id, {
      ...second,
      status: 'done',
      finishedAt: new Date().toISOString(),
    });
    const withArtifact = advanceWorkflow(repo, workflow.id, h.deps);
    const artifact = h.starts.find(job => job.type === 'cover-letter') as JobRecord;
    h.jobs.set(artifact.id, {
      ...artifact,
      status: 'done',
      finishedAt: new Date().toISOString(),
    });

    const finished = advanceWorkflow(repo, withArtifact.id, h.deps);

    expect(finished.status).toBe('partial');
    expect(finished.finishedAt).not.toBeNull();
  });

  it('cancelling one child skips only its dependent branch', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(
      repo,
      {
        targets: [{ num: 1 }, { num: 2 }],
        modes: ['evaluate', 'cover-letter'],
      },
      h.deps,
    );
    const [first, second] = h.starts as [JobRecord, JobRecord];
    h.jobs.set(first.id, {
      ...first,
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    });
    h.jobs.set(second.id, {
      ...second,
      status: 'done',
      finishedAt: new Date().toISOString(),
    });

    const advanced = advanceWorkflow(repo, workflow.id, h.deps);

    expect(
      advanced.steps.find(step => step.targetIndex === 0 && step.mode === 'cover-letter')?.status,
    ).toBe('skipped');
    expect(
      advanced.steps.find(step => step.targetIndex === 1 && step.mode === 'cover-letter')?.status,
    ).toBe('running');
  });

  it('marks a workflow child as error when restart reconciliation cannot find its job record', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(repo, { targets: [{ num: 12 }], modes: ['evaluate'] }, h.deps);
    h.jobs.clear();

    const reconciled = advanceWorkflow(repo, workflow.id, h.deps);

    expect(reconciled.status).toBe('error');
    expect(reconciled.steps[0]).toMatchObject({
      status: 'error',
      error: 'child job record is missing',
    });
  });

  it('cancels active children and every unstarted step', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(
      repo,
      { targets: [{ num: 12 }], modes: ['evaluate', 'cover-letter'] },
      h.deps,
    );

    const cancelled = cancelWorkflow(repo, workflow.id, h.deps);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.steps.every(step => step.status === 'cancelled')).toBe(true);
    expect(h.cancellations).toEqual([h.starts[0]?.id]);
    expect(getWorkflow(repo, workflow.id)?.status).toBe('cancelled');
  });

  it('does not rewrite an already-finished workflow as cancelled', () => {
    const repo = root();
    const h = harness();
    const workflow = createWorkflow(repo, { targets: [{ num: 12 }], modes: ['evaluate'] }, h.deps);
    const job = h.starts[0] as JobRecord;
    h.jobs.set(job.id, {
      ...job,
      status: 'done',
      finishedAt: new Date().toISOString(),
    });
    const finished = advanceWorkflow(repo, workflow.id, h.deps);

    const unchanged = cancelWorkflow(repo, workflow.id, h.deps);

    expect(finished.status).toBe('done');
    expect(unchanged.status).toBe('done');
    expect(h.cancellations).toEqual([]);
  });
});
