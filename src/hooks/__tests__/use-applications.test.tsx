// src/hooks/__tests__/use-applications.test.tsx
//
// useUpdateApplicationStatus must surface a failed PATCH on EVERY path —
// the table pill fires `mutate` with no per-call callbacks, so the failure
// toast has to live at the hook level (mirrors the kanban drag's catch
// toast in features/pipeline/board.tsx). Mocks the server-action module so
// no real applications.md / status-log.jsonl is ever touched.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/toast/toast-store';
import { useUpdateApplicationStatus, useUpdateReportField } from '@/hooks/use-applications';
import { openStatusFollowup } from '@/lib/open-status-followup';
import {
  updateApplicationStatusAction,
  updateReportFieldAction,
} from '@/server/actions/applications';

vi.mock('@/server/actions/applications', () => ({
  updateApplicationStatusAction: vi.fn(),
  updateReportFieldAction: vi.fn(),
  deleteApplicationAction: vi.fn(),
}));
vi.mock('@/lib/open-status-followup', () => ({
  openStatusFollowup: vi.fn(),
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  // Reset the module-global toast store between tests.
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useUpdateApplicationStatus', () => {
  it('pushes a danger toast when the status PATCH fails (no per-call onError)', async () => {
    vi.mocked(updateApplicationStatusAction).mockRejectedValueOnce(
      new Error('applications.md is locked'),
    );
    const { result } = renderHook(() => useUpdateApplicationStatus(), {
      wrapper: makeWrapper(),
    });

    // Fire-and-forget, exactly like the table pill path (offers-table.tsx).
    act(() => {
      result.current.mutate({ num: 7, status: 'applied' });
    });

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].tone).toBe('danger');
      expect(toasts[0].message).toBe('applications.md is locked');
    });
    expect(openStatusFollowup).not.toHaveBeenCalled();
  });

  it('opens the returned followup and invalidates every existing cache key on success', async () => {
    vi.mocked(updateApplicationStatusAction).mockResolvedValueOnce({
      updated: { num: 7, status: 'Interview' },
      followup: { num: 7, jobKind: 'interview-prep' },
    } as Awaited<ReturnType<typeof updateApplicationStatusAction>>);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateApplicationStatus(), { wrapper });

    act(() => {
      result.current.mutate({ num: 7, status: 'applied' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(openStatusFollowup).toHaveBeenCalledWith({
      num: 7,
      jobKind: 'interview-prep',
    });
    const keys = spy.mock.calls.map(c => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(['applications']));
    expect(keys).toContain(JSON.stringify(['application', 7]));
    expect(keys).toContain(JSON.stringify(['report']));
    expect(keys).toContain(JSON.stringify(['status-log']));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('passes a null followup to the safe adapter on success', async () => {
    vi.mocked(updateApplicationStatusAction).mockResolvedValueOnce({
      updated: { num: 7, status: 'Applied' },
      followup: null,
    } as Awaited<ReturnType<typeof updateApplicationStatusAction>>);
    const { result } = renderHook(() => useUpdateApplicationStatus(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.mutate({ num: 7, status: 'applied' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(openStatusFollowup).toHaveBeenCalledWith(null);
  });
});

describe('useUpdateReportField', () => {
  it('invalidates the drawer key [application, num] (not just list + report)', async () => {
    vi.mocked(updateReportFieldAction).mockResolvedValueOnce(undefined);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateReportField(), { wrapper });

    act(() => {
      result.current.mutate({ num: 42, field: 'archetype', value: 'Solutions Engineer' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = spy.mock.calls.map(c => JSON.stringify(c[0]?.queryKey));
    // The drawer reads ['application', num] — previously NOT invalidated, so a
    // chip edit in the drawer never refetched ("the chip won't change").
    expect(keys).toContain(JSON.stringify(['application', 42]));
    expect(keys).toContain(JSON.stringify(['applications']));
    expect(keys).toContain(JSON.stringify(['report']));
  });
});
