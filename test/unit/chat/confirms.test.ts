// test/unit/chat/confirms.test.ts
//
// Unit tests for the in-memory confirm-token store
// (src/lib/server/chat/confirms.ts).
//
// Pattern B (mirrors src/server/actions/__tests__/jobs.test.ts): tmpdir
// fixture + vi.resetModules() + dynamic import, with two mocks:
//   - @/lib/server/chat/turn-runner — records emitted turn events without
//     needing the live turn registry.
//   - @/lib/server/jobs/runner — spawnJob stubbed so an approved
//     start-job never forks a real CLI process against the tmpdir.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emitTurnEventMock = vi.fn();
const spawnJobMock = vi.fn();

vi.mock('@/lib/server/chat/turn-runner', () => ({ emitTurnEvent: emitTurnEventMock }));
vi.mock('@/lib/server/jobs/runner', () => ({ spawnJob: spawnJobMock }));

const APPLICATIONS_MD = [
  '# Applications Tracker',
  '',
  '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes |',
  '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- |',
  '| 1001 | 2026-05-15 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     |',
  '',
].join('\n');

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'chat-confirms-test-'));
  mkdirSync(join(root, 'data/jobs'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), APPLICATIONS_MD, 'utf-8');
  // startJob's first-run preflight refuses to queue without cv.md + profile.yml.
  mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
  writeFileSync(join(root, 'inputs/personalization/cv.md'), '# CV\n', 'utf-8');
  writeFileSync(join(root, 'inputs/personalization/profile.yml'), 'name: Test\n', 'utf-8');
  return root;
}

/** Flush the setImmediate that defers spawnJob inside createJob. */
async function flushImmediate(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

type ConfirmsModule = typeof import('@/lib/server/chat/confirms');

describe('chat confirms store', () => {
  let root: string;
  let confirms: ConfirmsModule;

  beforeEach(async () => {
    root = seedRoot();
    vi.resetModules();
    confirms = await import('@/lib/server/chat/confirms');
    emitTurnEventMock.mockReset();
    spawnJobMock.mockReset();
  });

  afterEach(async () => {
    // Restore real timers BEFORE awaiting flushImmediate — the "expiry"
    // test leaves fake timers active, and a faked setImmediate never
    // fires on its own, hanging this hook (and cascading into the next
    // test) if the order were reversed.
    vi.useRealTimers();
    await flushImmediate();
    rmSync(root, { recursive: true, force: true });
  });

  it('createConfirm returns a uuid token and emits a confirm event on the turn', () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'set-status',
      payload: { num: 1001, status: 'applied' },
      summary: 'Set offer #1001 status to "applied"',
      meta: 'tracker write · no AI spend',
    });
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(emitTurnEventMock).toHaveBeenCalledTimes(1);
    expect(emitTurnEventMock).toHaveBeenCalledWith('turn-1', {
      type: 'confirm',
      token,
      summary: 'Set offer #1001 status to "applied"',
      meta: 'tracker write · no AI spend',
      // The confirm event carries its action kind so the resolved card can
      // render an action-specific done message.
      kind: 'set-status',
    });
  });

  it('approve executes a set-status payload and emits confirm-resolved', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'set-status',
      payload: { num: 1001, status: 'applied' },
      summary: 's',
      meta: 'm',
    });
    const res = await confirms.resolveConfirm(root, token, true);
    expect(res.outcome).toBe('approved');
    expect(res.result).toMatchObject({ ok: true });
    const md = readFileSync(join(root, 'data/applications.md'), 'utf-8');
    expect(md).toContain('| Applied |');
    expect(emitTurnEventMock).toHaveBeenLastCalledWith('turn-1', {
      type: 'confirm-resolved',
      token,
      outcome: 'approved',
      execution: 'succeeded',
    });
  });

  it('approve executes a start-job payload through the shared startJob path', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'start-job',
      payload: { kind: 'evaluate', params: { num: 1001 } },
      summary: 's',
      meta: 'm',
    });
    const res = await confirms.resolveConfirm(root, token, true);
    expect(res.outcome).toBe('approved');
    expect(res.result).toMatchObject({ ok: true });
    const files = readdirSync(join(root, 'data/jobs')).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(1);
    const record = JSON.parse(readFileSync(join(root, 'data/jobs', files[0]), 'utf-8'));
    expect(record.type).toBe('evaluate');
    expect(record.status).toBe('queued');
    await flushImmediate();
    expect(spawnJobMock).toHaveBeenCalledTimes(1);
  });

  it('approve executes an exact cancel-job payload through the shared lifecycle', async () => {
    const jobId = '0123456789abcdef';
    writeFileSync(
      join(root, 'data/jobs', `${jobId}.json`),
      JSON.stringify({
        id: jobId,
        type: 'evaluate',
        status: 'queued',
        params: { num: 1001 },
        startedAt: '2026-07-28T10:00:00.000Z',
        finishedAt: null,
        output: '',
        error: null,
        exitCode: null,
      }),
    );
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'cancel-job',
      payload: { jobId },
      summary: 'Cancel evaluation for offer #1001',
      meta: `job ${jobId}`,
    });
    const res = await confirms.resolveConfirm(root, token, true);
    expect(res).toMatchObject({
      outcome: 'approved',
      execution: 'succeeded',
      result: { ok: true, cancellation: { cancelled: true, job: { status: 'cancelled' } } },
    });
  });

  it('records an unchanged execution when a cancel approval arrives after completion', async () => {
    const jobId = '0123456789abcdee';
    writeFileSync(
      join(root, 'data/jobs', `${jobId}.json`),
      JSON.stringify({
        id: jobId,
        type: 'evaluate',
        status: 'done',
        params: { num: 1001 },
        startedAt: '2026-07-28T10:00:00.000Z',
        finishedAt: '2026-07-28T10:01:00.000Z',
        output: '',
        error: null,
        exitCode: 0,
      }),
    );
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'cancel-job',
      payload: { jobId },
      summary: 'Cancel evaluation for offer #1001',
      meta: `job ${jobId}`,
    });

    const res = await confirms.resolveConfirm(root, token, true);

    expect(res).toMatchObject({
      outcome: 'approved',
      execution: 'unchanged',
      result: { ok: true, cancellation: { cancelled: false, job: { status: 'done' } } },
    });
    expect(emitTurnEventMock).toHaveBeenLastCalledWith('turn-1', {
      type: 'confirm-resolved',
      token,
      outcome: 'approved',
      execution: 'unchanged',
    });
  });

  it('approve creates a pasted-text offer and starts the optional mode as one action', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'create-offer-from-text',
      payload: {
        text: 'Build reliable systems.',
        company: 'Acme',
        role: 'Platform Engineer',
        startKind: 'cover-letter',
      },
      summary: 'Create offer from pasted text',
      meta: 'local tracker write · then start cover letter',
    });
    const res = await confirms.resolveConfirm(root, token, true);
    expect(res).toMatchObject({
      outcome: 'approved',
      result: {
        ok: true,
        textOffer: { reused: false, offer: { company: 'Acme', role: 'Platform Engineer' } },
        job: { type: 'cover-letter' },
        message: expect.stringMatching(/Offer #\d+ created/i),
        links: [
          {
            label: expect.stringMatching(/^Offer #\d+$/),
            href: expect.stringMatching(/^\/report\/\d+$/),
          },
        ],
      },
    });
    expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toContain(
      'Platform Engineer',
    );
    await flushImmediate();
    expect(spawnJobMock).toHaveBeenCalledTimes(1);
  });

  it('starts pasted-text screening with evaluation queued as a separate successor job', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'create-offer-from-text',
      payload: {
        text: 'Own platform reliability.',
        company: 'Acme',
        role: 'Staff Engineer',
        startKind: 'screen-evaluate',
      },
      summary: 'Create, screen, and evaluate offer',
      meta: 'local tracker write · then start screen + evaluate',
    });
    const res = await confirms.resolveConfirm(root, token, true);
    expect(res).toMatchObject({
      outcome: 'approved',
      result: {
        ok: true,
        job: {
          type: 'screen',
          params: expect.objectContaining({ then: 'evaluate' }),
        },
        message: expect.stringMatching(/evaluation will start after screening succeeds/i),
      },
    });
    expect(emitTurnEventMock).toHaveBeenLastCalledWith(
      'turn-1',
      expect.objectContaining({
        type: 'confirm-resolved',
        token,
        message: expect.stringMatching(/evaluation will start after screening succeeds/i),
        links: [expect.objectContaining({ href: expect.stringMatching(/^\/report\//) })],
      }),
    );
  });

  it('approves one workflow confirmation and starts only its first sequential child', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'start-workflow',
      payload: {
        targets: [{ num: 1001 }],
        modes: ['screen-evaluate'],
      },
      summary: 'Run screening then evaluation',
      meta: 'screening → evaluation',
    });

    const res = await confirms.resolveConfirm(root, token, true);

    expect(res).toMatchObject({
      outcome: 'approved',
      execution: 'succeeded',
      result: {
        ok: true,
        workflow: {
          status: 'running',
          requestedModes: ['screen-evaluate'],
          steps: [
            { mode: 'screen', status: 'running' },
            { mode: 'evaluate', status: 'blocked' },
          ],
        },
        jobs: [{ type: 'screen' }],
        message: expect.stringMatching(/Workflow started/i),
        links: [{ label: 'Offer #1001', href: '/report/1001' }],
      },
    });
    await flushImmediate();
    expect(spawnJobMock).toHaveBeenCalledTimes(1);
  });

  it('creates a pasted-text offer and a dependency-aware workflow in one approval', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'create-offer-from-text',
      payload: {
        text: 'Build durable infrastructure.',
        company: 'Acme',
        role: 'Infrastructure Engineer',
        modes: ['screen-evaluate', 'cover-letter'],
      },
      summary: 'Create offer and run workflow',
      meta: 'local tracker write · screening → evaluation → cover letter',
    });

    const res = await confirms.resolveConfirm(root, token, true);

    expect(res).toMatchObject({
      outcome: 'approved',
      execution: 'succeeded',
      result: {
        ok: true,
        textOffer: {
          reused: false,
          offer: { company: 'Acme', role: 'Infrastructure Engineer' },
        },
        workflow: {
          requestedModes: ['screen-evaluate', 'cover-letter'],
          steps: [
            { mode: 'screen', status: 'running' },
            { mode: 'evaluate', status: 'blocked' },
            { mode: 'cover-letter', status: 'blocked' },
          ],
        },
        jobs: [{ type: 'screen' }],
        links: [{ href: expect.stringMatching(/^\/report\/\d+$/) }],
      },
    });
    await flushImmediate();
    expect(spawnJobMock).toHaveBeenCalledTimes(1);
  });

  it('defensively rejects a persisted text-offer payload that combines legacy and workflow modes', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'create-offer-from-text',
      payload: {
        text: 'Build durable infrastructure.',
        company: 'Acme',
        role: 'Infrastructure Engineer',
        startKind: 'screen',
        modes: ['evaluate'],
      },
      summary: 'Create offer and run modes',
      meta: 'invalid persisted payload',
    });

    const res = await confirms.resolveConfirm(root, token, true);

    expect(res).toMatchObject({
      outcome: 'approved',
      execution: 'failed',
      result: { ok: false, error: 'startKind and modes cannot be combined' },
    });
    expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
    expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).not.toContain(
      'Infrastructure Engineer',
    );
  });

  it('cancel executes nothing and emits confirm-resolved cancelled', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'start-job',
      payload: { kind: 'evaluate', params: { num: 1001 } },
      summary: 's',
      meta: 'm',
    });
    const res = await confirms.resolveConfirm(root, token, false);
    expect(res.outcome).toBe('cancelled');
    expect(res.result).toBeUndefined();
    expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
    expect(emitTurnEventMock).toHaveBeenLastCalledWith('turn-1', {
      type: 'confirm-resolved',
      token,
      outcome: 'cancelled',
    });
  });

  it('double-resolve: the second resolve returns expired and executes nothing', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'set-status',
      payload: { num: 1001, status: 'applied' },
      summary: 's',
      meta: 'm',
    });
    await confirms.resolveConfirm(root, token, false);
    const second = await confirms.resolveConfirm(root, token, true);
    expect(second.outcome).toBe('expired');
    // 1 confirm + 1 confirm-resolved — the expired path emits nothing.
    expect(emitTurnEventMock).toHaveBeenCalledTimes(2);
    // Fixture's original column padding is two trailing spaces
    // ("| Screened  |") — asserting the exact seeded substring proves the
    // row was never touched.
    expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toContain('| Screened  |');
  });

  it('a confirm expires after 15 minutes and never executes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'set-status',
      payload: { num: 1001, status: 'applied' },
      summary: 's',
      meta: 'm',
    });
    vi.setSystemTime(new Date('2026-07-18T12:16:00Z'));
    const res = await confirms.resolveConfirm(root, token, true);
    expect(res.outcome).toBe('expired');
    expect(res.result).toBeUndefined();
    expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toContain('| Screened  |');
    expect(emitTurnEventMock).toHaveBeenCalledTimes(1); // only the original confirm event
  });

  it('an execution failure surfaces as ok:false without breaking resolution', async () => {
    const { token } = confirms.createConfirm(root, {
      turnId: 'turn-1',
      kind: 'start-job',
      payload: { kind: 'evaluate', params: { num: 99999 } },
      summary: 's',
      meta: 'm',
    });
    const res = await confirms.resolveConfirm(root, token, true);
    expect(res.outcome).toBe('approved');
    expect(res.result).toMatchObject({ ok: false });
    if (res.result && res.result.ok === false) {
      expect(res.result.error).toMatch(/num not found/);
    }
  });

  it('describeStartJob builds summary + provider·model·duration meta', () => {
    const d = confirms.describeStartJob(root, 'evaluate', { num: 1001 });
    expect(d.summary).toBe('Start evaluation for offer #1001');
    // A bare tmp root resolves via registry level 5 (hardcoded pair);
    // evaluate's estimateS=600 formats as ~7–15 min. Duration only —
    // src/lib/job-types.ts carries no cost figures.
    expect(d.meta).toBe('claude · claude-sonnet-4-6 · ~7–15 min');
  });

  it('describeStartJob omits the offer suffix for system kinds', () => {
    const d = confirms.describeStartJob(root, 'scan');
    expect(d.summary).toBe('Start portal scan');
    expect(d.meta).toContain(' min');
  });

  it('describeStartWorkflow shows sequential and parallel phases from the actual plan', async () => {
    const { planWorkflow } = await import('@/lib/server/workflows');
    const plan = planWorkflow({
      targets: [{ num: 1001 }],
      modes: ['screen-evaluate', 'cover-letter', 'tailor-cv'],
      evaluatedOfferNums: new Set(),
    });

    const d = confirms.describeStartWorkflow(
      {
        targets: [{ num: 1001 }],
        modes: ['screen-evaluate', 'cover-letter', 'tailor-cv'],
      },
      plan,
    );

    expect(d.meta).toContain('screening → evaluation');
    expect(d.meta).toContain('cover letter + CV tailoring');
    expect(d.meta).toContain('max 4 parallel');
  });

  it('describeSetStatus marks the write as spend-free', () => {
    const d = confirms.describeSetStatus(1001, 'applied');
    expect(d.summary).toBe('Set offer #1001 status to "applied"');
    expect(d.meta).toBe('tracker write · no AI spend');
  });
});
