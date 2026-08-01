import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  activeUpdateJobKey,
  type UpdateCheckResponse,
  updateJobKey,
  useActiveUpdateJob,
  useUpdateApply,
  useUpdateJob,
} from '@/hooks/use-system';
import type { UpdateJob } from '@/lib/schemas/update-job';

const JOB_ID = '26cf6d7a-2763-4b9d-b539-930fa8414bd5';

function makeJob(overrides: Partial<UpdateJob> = {}): UpdateJob {
  return {
    id: JOB_ID,
    phase: 'queued',
    launchState: 'claim-pending',
    mode: { prod: false, tailscale: false },
    fromVersion: '0.3.2',
    toVersion: '0.4.0',
    createdAt: '2026-07-31T20:00:00.000Z',
    updatedAt: '2026-07-31T20:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : status === 500 ? 'Internal Server Error' : 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

async function flushMicrotasks() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('UpdateCheckResponse', () => {
  it('models every response shape emitted by the update check route', () => {
    expectTypeOf<UpdateCheckResponse>().toEqualTypeOf<
      | { status: 'update-available'; local: string; remote: string; changelog: string }
      | { status: 'up-to-date'; local: string; remote: string }
      | { status: 'dismissed' }
      | { status: 'offline'; local: string }
    >();

    const responses: UpdateCheckResponse[] = [
      { status: 'dismissed' },
      { status: 'offline', local: '0.3.2' },
      { status: 'up-to-date', local: '0.3.2', remote: '0.3.2' },
      {
        status: 'update-available',
        local: '0.3.2',
        remote: '0.4.0',
        changelog: 'Faster restart',
      },
    ];

    expect(responses.map(response => response.status)).toEqual([
      'dismissed',
      'offline',
      'up-to-date',
      'update-available',
    ]);
  });
});

describe('useUpdateApply', () => {
  it('POSTs without a JSON body when no target version is supplied', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ jobId: JOB_ID }, 202));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateApply(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync()).resolves.toEqual({ jobId: JOB_ID });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/update/apply', { method: 'POST' });
  });

  it('POSTs the optional target version as JSON when supplied', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ jobId: JOB_ID }, 202));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateApply(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ toVersion: '0.4.0' });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/update/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toVersion: '0.4.0' }),
    });
  });
});

describe('useActiveUpdateJob', () => {
  it('does not discover when Settings already has a retained job id', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useActiveUpdateJob(false), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(activeUpdateJobKey()).toEqual(['system', 'active-update-job']);
  });

  it('polls until it discovers a recovery-queued job, then stops', async () => {
    vi.useFakeTimers();
    const recoveryQueued = makeJob({ phase: 'recovery-queued' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ job: null }))
      .mockResolvedValueOnce(jsonResponse({ job: recoveryQueued }));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveUpdateJob(true), { wrapper });

    await flushMicrotasks();
    expect(result.current.data).toEqual({ job: null });

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await flushMicrotasks();
    expect(result.current.data).toEqual({ job: recoveryQueued });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/update/status', undefined);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('useUpdateJob', () => {
  it.each([undefined, null, '', '   ', 'not-a-uuid'])('does not fetch for invalid id %j', jobId => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useUpdateJob(jobId), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateJobKey(jobId)).toEqual(['system', 'update-job', jobId ?? null]);
  });

  it('polls every second while active and stops after a terminal phase', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(makeJob({ phase: 'queued' })))
      .mockResolvedValueOnce(
        jsonResponse(
          makeJob({
            phase: 'applying',
            launchState: 'owned',
            pid: 4242,
            updatedAt: '2026-07-31T20:00:01.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          makeJob({
            phase: 'succeeded',
            launchState: undefined,
            pid: undefined,
            updatedAt: '2026-07-31T20:00:02.000Z',
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateJob(JOB_ID), { wrapper });

    await flushMicrotasks();
    expect(result.current.data?.phase).toBe('queued');

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await flushMicrotasks();
    expect(result.current.data?.phase).toBe('applying');

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await flushMicrotasks();
    expect(result.current.data?.phase).toBe('succeeded');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['succeeded', 'rolled-back', 'failed'] as const)(
    'does not poll after initial terminal phase %s',
    async phase => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(async () => jsonResponse(makeJob({ phase })));
      vi.stubGlobal('fetch', fetchMock);
      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useUpdateJob(JOB_ID), { wrapper });

      await flushMicrotasks();
      expect(result.current.data?.phase).toBe(phase);

      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('retains the last successful job while restart downtime retries are in flight', async () => {
    vi.useFakeTimers();
    const active = makeJob({
      phase: 'restarting',
      launchState: 'owned',
      pid: 4242,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(active))
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateJob(JOB_ID), { wrapper });

    await flushMicrotasks();
    expect(result.current.data).toEqual(active);

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(active);

    await act(async () => vi.advanceTimersByTimeAsync(7000));
    await flushMicrotasks();
    expect(result.current.data).toEqual(active);
  });

  it.each([
    ['network failures', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['server failures', () => Promise.resolve(jsonResponse({ error: 'restarting' }, 500))],
  ])('retries %s with a bounded policy', async (_label, response) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(response);
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateJob(JOB_ID), { wrapper });

    await act(async () => vi.advanceTimersByTimeAsync(7000));
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.isError).toBe(true);
  });

  it('does not retry a 404 response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Update job not found' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateJob(JOB_ID), { wrapper });

    await flushMicrotasks();

    expect(result.current.isError).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
