import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateJob } from '@/lib/schemas/update-job';

const mocks = vi.hoisted(() => ({ loadUpdateJob: vi.fn(), reconcileUpdateJob: vi.fn() }));

vi.mock('@/lib/server/update-orchestrator', () => ({
  loadUpdateJob: mocks.loadUpdateJob,
  reconcileUpdateJob: mocks.reconcileUpdateJob,
}));

const JOB_ID = '26cf6d7a-2763-4b9d-b539-930fa8414bd5';

function job(): UpdateJob {
  return {
    id: JOB_ID,
    phase: 'restarting',
    launchState: 'owned',
    pid: 4321,
    mode: { prod: true, tailscale: false },
    fromVersion: '0.3.2',
    toVersion: '0.4.0',
    createdAt: '2026-07-31T20:00:00.000Z',
    updatedAt: '2026-07-31T20:01:00.000Z',
  };
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mocks.loadUpdateJob.mockReset();
  mocks.reconcileUpdateJob.mockReset();
});

describe('GET /api/update/status/[id]', () => {
  it('returns 400 for an invalid UUID without reading storage', async () => {
    const { GET } = await import('../route');
    const response = await GET(
      new Request('http://localhost/api/update/status/nope'),
      context('nope'),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid update job id' });
    expect(mocks.loadUpdateJob).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown job', async () => {
    mocks.loadUpdateJob.mockReturnValue(null);
    const { GET } = await import('../route');
    const response = await GET(
      new Request(`http://localhost/api/update/status/${JOB_ID}`),
      context(JOB_ID),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Update job not found' });
  });

  it('returns a schema-validated safe job document', async () => {
    mocks.loadUpdateJob.mockReturnValue(job());
    const { GET } = await import('../route');
    const response = await GET(
      new Request(`http://localhost/api/update/status/${JOB_ID}`),
      context(JOB_ID),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(job());
  });

  it('does not expose invalid persisted fields or loader error details', async () => {
    mocks.loadUpdateJob.mockReturnValue({
      ...job(),
      output: '/private/repo\nsecret command output',
    });
    const { GET } = await import('../route');
    const response = await GET(
      new Request(`http://localhost/api/update/status/${JOB_ID}`),
      context(JOB_ID),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Failed to load update job' });
    expect(JSON.stringify(body)).not.toContain('/private/repo');
  });

  it('returns a generic 500 when loading persisted state throws', async () => {
    mocks.loadUpdateJob.mockImplementation(() => {
      throw new Error('private storage detail');
    });
    const { GET } = await import('../route');

    const response = await GET(
      new Request(`http://localhost/api/update/status/${JOB_ID}`),
      context(JOB_ID),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to load update job' });
  });
});

describe('POST /api/update/status/[id]', () => {
  it('rejects cross-origin reconciliation', async () => {
    const { POST } = await import('../route');
    const response = await POST(
      new Request(`http://localhost/api/update/status/${JOB_ID}`, {
        method: 'POST',
        headers: { host: 'localhost', origin: 'https://evil.example' },
      }),
      context(JOB_ID),
    );

    expect(response.status).toBe(403);
    expect(mocks.reconcileUpdateJob).not.toHaveBeenCalled();
  });

  it('returns the reconciled safe job document', async () => {
    mocks.reconcileUpdateJob.mockReturnValue(job());
    const { POST } = await import('../route');
    const response = await POST(
      new Request(`http://localhost/api/update/status/${JOB_ID}`, { method: 'POST' }),
      context(JOB_ID),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(job());
  });

  it('returns a generic 500 when reconciliation throws', async () => {
    mocks.reconcileUpdateJob.mockImplementation(() => {
      throw new Error('private recovery detail');
    });
    const { POST } = await import('../route');

    const response = await POST(
      new Request(`http://localhost/api/update/status/${JOB_ID}`, { method: 'POST' }),
      context(JOB_ID),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to load update job' });
  });
});
