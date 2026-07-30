// test/unit/chat/chat-action-routes.test.ts
//
// Direct-call tests for the chat action route handlers (start-job,
// set-status). Pattern B: tmpdir + SUR9E_ROOT + vi.resetModules() +
// dynamic import; turn-runner and the job spawner are mocked.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emitTurnEventMock = vi.fn();
const spawnJobMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock('@/lib/server/chat/turn-runner', () => ({ emitTurnEvent: emitTurnEventMock }));
vi.mock('@/lib/server/jobs/runner', () => ({ spawnJob: spawnJobMock }));
vi.mock('@/server/revalidate', () => ({ revalidatePath: revalidatePathMock }));

const APPLICATIONS_MD = [
  '# Applications Tracker',
  '',
  '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes |',
  '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- |',
  '| 1001 | 2026-05-15 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     |',
  '',
].join('\n');

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'chat-routes-test-'));
  mkdirSync(join(root, 'data/jobs'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), APPLICATIONS_MD, 'utf-8');
  mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
  writeFileSync(join(root, 'inputs/personalization/cv.md'), '# CV\n', 'utf-8');
  writeFileSync(join(root, 'inputs/personalization/profile.yml'), 'name: Test\n', 'utf-8');
  return root;
}

function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function flushImmediate(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

type StartJobRoute = typeof import('@/app/api/chat/actions/start-job/route');
type SetStatusRoute = typeof import('@/app/api/chat/actions/set-status/route');
type CancelJobRoute = typeof import('@/app/api/chat/actions/cancel-job/route');
type CreateTextOfferRoute = typeof import('@/app/api/chat/actions/create-offer-from-text/route');
type StartWorkflowRoute = typeof import('@/app/api/chat/actions/start-workflow/route');
type CancelWorkflowRoute = typeof import('@/app/api/chat/actions/cancel-workflow/route');

describe('chat action routes', () => {
  let root: string;
  let startJobRoute: StartJobRoute;
  let setStatusRoute: SetStatusRoute;
  let cancelJobRoute: CancelJobRoute;
  let createTextOfferRoute: CreateTextOfferRoute;
  let startWorkflowRoute: StartWorkflowRoute;
  let cancelWorkflowRoute: CancelWorkflowRoute;

  beforeEach(async () => {
    root = seedRoot();
    process.env.SUR9E_ROOT = root;
    vi.resetModules();
    startJobRoute = await import('@/app/api/chat/actions/start-job/route');
    setStatusRoute = await import('@/app/api/chat/actions/set-status/route');
    cancelJobRoute = await import('@/app/api/chat/actions/cancel-job/route');
    createTextOfferRoute = await import('@/app/api/chat/actions/create-offer-from-text/route');
    startWorkflowRoute = await import('@/app/api/chat/actions/start-workflow/route');
    cancelWorkflowRoute = await import('@/app/api/chat/actions/cancel-workflow/route');
    emitTurnEventMock.mockReset();
    spawnJobMock.mockReset();
    revalidatePathMock.mockReset();
  });

  afterEach(async () => {
    await flushImmediate();
    rmSync(root, { recursive: true, force: true });
    delete process.env.SUR9E_ROOT;
    vi.clearAllMocks();
  });

  describe('POST /api/chat/actions/start-job', () => {
    it('web chat context: creates a confirm, starts nothing', async () => {
      const res = await startJobRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-job',
          { kind: 'evaluate', params: { num: 1001 } },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.needsConfirm).toBe(true);
      expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.summary).toBe('Start evaluation for offer #1001');
      expect(body.meta).toContain(' min');
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
      expect(emitTurnEventMock).toHaveBeenCalledWith(
        'turn-1',
        expect.objectContaining({ type: 'confirm', token: body.token }),
      );
    });

    it('web chat context: terminalApproved is ignored — still needs confirm', async () => {
      const res = await startJobRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-job',
          { kind: 'evaluate', params: { num: 1001 }, terminalApproved: true },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      const body = await res.json();
      expect(body.needsConfirm).toBe(true);
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
    });

    it('terminal context without approval: needs confirm, no token, no confirm stored', async () => {
      const res = await startJobRoute.POST(
        postJson('http://localhost/api/chat/actions/start-job', {
          kind: 'evaluate',
          params: { num: 1001 },
        }),
      );
      const body = await res.json();
      expect(body.needsConfirm).toBe(true);
      expect(body.token).toBeUndefined();
      expect(emitTurnEventMock).not.toHaveBeenCalled();
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
    });

    it('terminal context with terminalApproved: starts the job immediately', async () => {
      const res = await startJobRoute.POST(
        postJson('http://localhost/api/chat/actions/start-job', {
          kind: 'evaluate',
          params: { num: 1001 },
          terminalApproved: true,
        }),
      );
      const body = await res.json();
      expect(body.started).toBe(true);
      expect(body.job.type).toBe('evaluate');
      expect(body.message).toBe('Evaluation started for offer #1001.');
      expect(body.links).toEqual([{ label: 'Offer #1001', href: '/report/1001' }]);
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(1);
      await flushImmediate();
      expect(spawnJobMock).toHaveBeenCalledTimes(1);
    });

    it('expands an explicit URL screen-and-evaluate request into sequential jobs', async () => {
      const url = 'https://jobs.example.com/roles/123';
      const res = await startJobRoute.POST(
        postJson('http://localhost/api/chat/actions/start-job', {
          kind: 'screen-evaluate',
          params: { url },
          terminalApproved: true,
        }),
      );
      const body = await res.json();

      expect(body.started).toBe(true);
      expect(body.job).toMatchObject({
        type: 'screen',
        params: { url, then: 'evaluate' },
      });
      expect(body.message).toBe(
        'Screening started; evaluation will start after screening succeeds.',
      );
      await flushImmediate();
      expect(spawnJobMock).toHaveBeenCalledTimes(1);
    });

    it('cannot smuggle evaluation into a screen-only request through params', async () => {
      const url = 'https://jobs.example.com/roles/456';
      const res = await startJobRoute.POST(
        postJson('http://localhost/api/chat/actions/start-job', {
          kind: 'screen',
          params: { url, then: 'evaluate', next_job_id: 'attacker-controlled' },
          terminalApproved: true,
        }),
      );
      const body = await res.json();

      expect(body.started).toBe(true);
      expect(body.job).toMatchObject({ type: 'screen', params: { url } });
      expect(body.job.params).not.toHaveProperty('then');
      expect(body.job.params).not.toHaveProperty('next_job_id');
    });

    it('rejects an unknown kind with 400', async () => {
      const res = await startJobRoute.POST(
        postJson('http://localhost/api/chat/actions/start-job', { kind: 'nonsense' }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects a per-num kind without num with 400 (before any confirm)', async () => {
      const res = await startJobRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-job',
          { kind: 'evaluate' },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      expect(res.status).toBe(400);
      expect(emitTurnEventMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/chat/actions/create-offer-from-text', () => {
    it('web chat context combines the local write and optional run behind one confirm', async () => {
      const res = await createTextOfferRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/create-offer-from-text',
          {
            text: 'Build reliable systems.',
            company: 'Acme',
            role: 'Platform Engineer',
            startKind: 'tailor-cv',
          },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      const body = await res.json();
      expect(body.needsConfirm).toBe(true);
      expect(body.summary).toContain('Create offer from pasted text');
      expect(body.meta).toContain('then start CV tailoring');
      expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).not.toContain(
        'Platform Engineer',
      );
      expect(emitTurnEventMock).toHaveBeenCalledWith(
        'turn-1',
        expect.objectContaining({ kind: 'create-offer-from-text' }),
      );
    });

    it('terminal approval creates a tracked offer and starts the requested mode', async () => {
      const res = await createTextOfferRoute.POST(
        postJson('http://localhost/api/chat/actions/create-offer-from-text', {
          text: 'Build reliable systems.',
          company: 'Acme',
          role: 'Platform Engineer',
          startKind: 'tailor-cv',
          terminalApproved: true,
        }),
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.created).toBe(true);
      expect(body.offer.company).toBe('Acme');
      expect(body.job.type).toBe('tailor-cv');
      expect(body.message).toContain('Offer #');
      expect(body.links).toEqual([
        expect.objectContaining({
          label: expect.stringMatching(/^Offer #/),
          href: expect.stringMatching(/^\/report\//),
        }),
      ]);
      expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toContain(
        'Platform Engineer',
      );
      expect(revalidatePathMock).toHaveBeenCalledWith('/offers');
      await flushImmediate();
      expect(spawnJobMock).toHaveBeenCalledTimes(1);
    });

    it('starts screening first and queues evaluation as a separate successor job', async () => {
      const res = await createTextOfferRoute.POST(
        postJson('http://localhost/api/chat/actions/create-offer-from-text', {
          text: 'Own platform reliability.',
          company: 'Acme',
          role: 'Staff Engineer',
          startKind: 'screen-evaluate',
          terminalApproved: true,
        }),
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.job).toMatchObject({
        type: 'screen',
        params: { num: body.offer.num, then: 'evaluate' },
      });
      expect(body.message).toMatch(/evaluation will start after screening succeeds/i);
      expect(body.links).toEqual([
        { label: `Offer #${body.offer.num}`, href: `/report/${body.offer.num}` },
      ]);
    });

    it('rejects combining legacy startKind with workflow modes', async () => {
      const res = await createTextOfferRoute.POST(
        postJson('http://localhost/api/chat/actions/create-offer-from-text', {
          text: 'Own platform reliability.',
          company: 'Acme',
          role: 'Staff Engineer',
          startKind: 'screen',
          modes: ['screen', 'evaluate'],
          terminalApproved: true,
        }),
      );

      expect(res.status).toBe(400);
    });

    it('rejects an invalid workflow mode before creating or confirming the offer', async () => {
      const res = await createTextOfferRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/create-offer-from-text',
          {
            text: 'Own platform reliability.',
            company: 'Acme',
            role: 'Staff Engineer',
            modes: ['tracker'],
          },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );

      expect(res.status).toBe(400);
      expect(emitTurnEventMock).not.toHaveBeenCalled();
      expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).not.toContain(
        'Staff Engineer',
      );
    });
  });

  describe('workflow action routes', () => {
    it('parks the complete workflow behind one chat confirmation', async () => {
      const res = await startWorkflowRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-workflow',
          {
            targets: [{ num: 1001 }],
            modes: ['evaluate', 'cover-letter'],
          },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.needsConfirm).toBe(true);
      expect(body.summary).toContain('2 modes');
      expect(body.meta).toContain('evaluation');
      expect(emitTurnEventMock).toHaveBeenCalledWith(
        'turn-1',
        expect.objectContaining({ kind: 'start-workflow' }),
      );
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
    });

    it('starts and persists a terminal-approved workflow', async () => {
      const res = await startWorkflowRoute.POST(
        postJson('http://localhost/api/chat/actions/start-workflow', {
          targets: [{ num: 1001 }],
          modes: ['screen', 'evaluate'],
          terminalApproved: true,
        }),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.started).toBe(true);
      expect(body.workflow.status).toBe('running');
      expect(body.jobs).toEqual([expect.objectContaining({ type: 'screen' })]);
      expect(
        readdirSync(join(root, 'data/workflows')).filter(name => name.endsWith('.json')),
      ).toHaveLength(1);
    });

    it('rejects inline modes before creating a confirmation', async () => {
      const res = await startWorkflowRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-workflow',
          {
            targets: [{ num: 1001 }],
            modes: ['tracker'],
          },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );

      expect(res.status).toBe(400);
      expect(emitTurnEventMock).not.toHaveBeenCalled();
    });

    it('rejects an incompatible running singleton before confirmation', async () => {
      writeFileSync(
        join(root, 'data/jobs', '0123456789abcdef.json'),
        JSON.stringify({
          id: '0123456789abcdef',
          type: 'screen',
          status: 'queued',
          params: { url: 'https://example.com/jobs/already-running' },
          startedAt: new Date().toISOString(),
          finishedAt: null,
          output: '',
          error: null,
          exitCode: null,
        }),
      );

      const res = await startWorkflowRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-workflow',
          {
            targets: [{ url: 'https://example.com/jobs/new' }],
            modes: ['screen'],
          },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('screen is already running');
      expect(emitTurnEventMock).not.toHaveBeenCalled();
    });

    it('confirmation-gates workflow cancellation', async () => {
      const started = await startWorkflowRoute.POST(
        postJson('http://localhost/api/chat/actions/start-workflow', {
          targets: [{ num: 1001 }],
          modes: ['evaluate'],
          terminalApproved: true,
        }),
      );
      const workflowId = (await started.json()).workflow.id;
      const res = await cancelWorkflowRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/cancel-workflow',
          { workflowId },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );

      expect((await res.json()).needsConfirm).toBe(true);
      expect(emitTurnEventMock).toHaveBeenCalledWith(
        'turn-1',
        expect.objectContaining({ kind: 'cancel-workflow' }),
      );
    });
  });

  describe('POST /api/chat/actions/set-status', () => {
    it('web chat context: creates a confirm, writes nothing', async () => {
      const res = await setStatusRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/set-status',
          { num: 1001, status: 'applied' },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      const body = await res.json();
      expect(body.needsConfirm).toBe(true);
      expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.summary).toBe('Set offer #1001 status to "applied"');
      // Two spaces: asserting the exact seeded substring (not the trimmed
      // canonical form) proves the file was never rewritten — mirrors the
      // equivalent assertion in confirms.test.ts.
      expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toContain('| Screened  |');
    });

    it('terminal context with terminalApproved: writes the status', async () => {
      const res = await setStatusRoute.POST(
        postJson('http://localhost/api/chat/actions/set-status', {
          num: 1001,
          status: 'applied',
          terminalApproved: true,
        }),
      );
      const body = await res.json();
      expect(body.updated).toBe(true);
      expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toContain('| Applied |');
    });

    it('rejects an invalid status with 400', async () => {
      const res = await setStatusRoute.POST(
        postJson('http://localhost/api/chat/actions/set-status', {
          num: 1001,
          status: 'ghosted',
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/chat/actions/cancel-job', () => {
    const jobId = '0123456789abcdef';

    function seedQueuedJob() {
      writeFileSync(
        join(root, 'data/jobs', `${jobId}.json`),
        JSON.stringify({
          id: jobId,
          type: 'evaluate',
          status: 'queued',
          params: { num: 1001 },
          startedAt: new Date().toISOString(),
          finishedAt: null,
          output: '',
          error: null,
          exitCode: null,
        }),
      );
    }

    it('web chat context creates an exact-job confirm and cancels nothing yet', async () => {
      seedQueuedJob();
      const res = await cancelJobRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/cancel-job',
          { jobId },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      const body = await res.json();
      expect(body).toMatchObject({
        needsConfirm: true,
        summary: 'Cancel evaluation for offer #1001',
      });
      expect(
        JSON.parse(readFileSync(join(root, 'data/jobs', `${jobId}.json`), 'utf-8')).status,
      ).toBe('queued');
      expect(emitTurnEventMock).toHaveBeenCalledWith(
        'turn-1',
        expect.objectContaining({ type: 'confirm', kind: 'cancel-job' }),
      );
    });

    it('terminal context requires approval, then cancels only that job', async () => {
      seedQueuedJob();
      const pending = await cancelJobRoute.POST(
        postJson('http://localhost/api/chat/actions/cancel-job', { jobId }),
      );
      expect(await pending.json()).toMatchObject({ needsConfirm: true });

      const approved = await cancelJobRoute.POST(
        postJson('http://localhost/api/chat/actions/cancel-job', {
          jobId,
          terminalApproved: true,
        }),
      );
      expect(await approved.json()).toMatchObject({
        cancelled: true,
        job: { id: jobId, status: 'cancelled' },
      });
    });
  });
});
