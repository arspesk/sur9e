import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateJob } from '@/lib/schemas/update-job';
import type { StartUpdateJobResult } from '@/lib/server/update-orchestrator';
import packageJson from '../../../../../../package.json';

const mocks = vi.hoisted(() => ({
  getWebLaunchMode: vi.fn(),
  runUpdateSystem: vi.fn(),
  startUpdateJob: vi.fn(),
}));

vi.mock('@/lib/server/update-orchestrator', () => ({
  startUpdateJob: mocks.startUpdateJob,
}));

// Regression guard: the route must not retain the old synchronous updater.
vi.mock('@/lib/server/update-system', () => ({
  runUpdateSystem: mocks.runUpdateSystem,
}));

vi.mock('../../../../../../scripts/web.mjs', () => ({
  getWebLaunchMode: mocks.getWebLaunchMode,
}));

const JOB_ID = '26cf6d7a-2763-4b9d-b539-930fa8414bd5';

function job(overrides: Partial<UpdateJob> = {}): UpdateJob {
  return {
    id: JOB_ID,
    phase: 'queued',
    launchState: 'claim-pending',
    mode: { prod: false, tailscale: false },
    fromVersion: packageJson.version,
    createdAt: '2026-07-31T20:00:00.000Z',
    updatedAt: '2026-07-31T20:00:00.000Z',
    ...overrides,
  };
}

function request(
  body?: string,
  {
    origin = 'http://localhost:3000',
    host = 'localhost:3000',
    url = 'http://localhost:3000/api/update/apply',
  }: { origin?: string; host?: string; url?: string } = {},
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      host,
      ...(origin === '' ? {} : { origin }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.getWebLaunchMode.mockReset().mockReturnValue({ prod: false, tailscale: false });
  mocks.runUpdateSystem.mockReset();
  mocks.startUpdateJob.mockReset().mockReturnValue({ status: 'started', job: job() });
});

describe('POST /api/update/apply', () => {
  it('starts a durable update job and returns its id with 202', async () => {
    const { POST } = await import('../route');
    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ jobId: JOB_ID });
    expect(mocks.startUpdateJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        fromVersion: packageJson.version,
        mode: { prod: false, tailscale: false },
      }),
    );
    expect(mocks.runUpdateSystem).not.toHaveBeenCalled();
  });

  it('accepts a strict optional toVersion body and forwards the version', async () => {
    const { POST } = await import('../route');
    const response = await POST(request(JSON.stringify({ toVersion: '0.4.0' })));

    expect(response.status).toBe(202);
    expect(mocks.startUpdateJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ toVersion: '0.4.0' }),
    );
  });

  it.each([
    ['malformed JSON', '{'],
    ['an unknown property', JSON.stringify({ output: '/private/repo' })],
    ['a non-string version', JSON.stringify({ toVersion: 4 })],
    ['an empty version', JSON.stringify({ toVersion: '' })],
  ])('returns 400 for %s', async (_label, body) => {
    const { POST } = await import('../route');
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request body' });
    expect(mocks.startUpdateJob).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-origin', 'https://attacker.example'],
    ['malformed', 'not a URL'],
  ])('rejects a %s Origin before parsing or launching', async (_label, origin) => {
    const { POST } = await import('../route');
    const response = await POST(request('{', { origin }));

    expect(response.status).toBe(403);
    expect(mocks.getWebLaunchMode).not.toHaveBeenCalled();
    expect(mocks.startUpdateJob).not.toHaveBeenCalled();
  });

  it('returns a safe 409 with the active job id', async () => {
    mocks.startUpdateJob.mockReturnValue({ status: 'busy', job: job() });
    const { POST } = await import('../route');
    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'An update is already running', jobId: JOB_ID });
  });

  it('returns a safe 409 without a job id when the launch lock is held', async () => {
    mocks.startUpdateJob.mockReturnValue({ status: 'busy', job: null });
    const { POST } = await import('../route');
    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'An update is already running' });
  });

  it.each([
    ['reported failure', { status: 'failed', job: job({ phase: 'failed' }) }],
    ['thrown failure', new Error('/private/repo: spawn output')],
  ])('returns a safe 500 for a %s', async (_label, outcome) => {
    if (outcome instanceof Error)
      mocks.startUpdateJob.mockImplementation(() => Promise.reject(outcome));
    else mocks.startUpdateJob.mockReturnValue(outcome as StartUpdateJobResult);
    const { POST } = await import('../route');
    const response = await POST(request());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Failed to start update' });
    expect(JSON.stringify(body)).not.toContain('/private/repo');
  });

  it('uses authoritative persisted launcher metadata', async () => {
    mocks.getWebLaunchMode.mockReturnValue({ prod: true, tailscale: true });
    const { POST } = await import('../route');
    await POST(request());

    expect(mocks.startUpdateJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ mode: { prod: true, tailscale: true } }),
    );
  });

  it.each(['localhost', '127.0.0.1'])(
    'falls back to production without inferring Tailscale on %s',
    async hostname => {
      vi.stubEnv('NODE_ENV', 'production');
      const { POST } = await import('../route');
      await POST(
        request(undefined, {
          origin: `http://${hostname}:3000`,
          host: `${hostname}:3000`,
          url: `http://${hostname}:3000/api/update/apply`,
        }),
      );

      expect(mocks.startUpdateJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mode: { prod: true, tailscale: false } }),
      );
    },
  );

  it('does not infer Tailscale from an HTTP ts.net origin', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { POST } = await import('../route');
    await POST(
      request(undefined, {
        origin: 'http://sur9e.example-tailnet.ts.net',
        host: 'sur9e.example-tailnet.ts.net',
        url: 'http://sur9e.example-tailnet.ts.net/api/update/apply',
      }),
    );

    expect(mocks.startUpdateJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ mode: { prod: false, tailscale: false } }),
    );
  });

  it('may infer Tailscale from an HTTPS ts.net origin', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { POST } = await import('../route');
    await POST(
      request(undefined, {
        origin: 'https://sur9e.example-tailnet.ts.net',
        host: 'sur9e.example-tailnet.ts.net',
        url: 'https://sur9e.example-tailnet.ts.net/api/update/apply',
      }),
    );

    expect(mocks.startUpdateJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ mode: { prod: false, tailscale: true } }),
    );
  });
});
