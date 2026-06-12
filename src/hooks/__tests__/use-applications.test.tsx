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
import { useUpdateApplicationStatus } from '@/hooks/use-applications';
import { updateApplicationStatusAction } from '@/server/actions/applications';

vi.mock('@/server/actions/applications', () => ({
  updateApplicationStatusAction: vi.fn(),
  updateReportFieldAction: vi.fn(),
  deleteApplicationAction: vi.fn(),
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
  });

  it('does not toast on success', async () => {
    vi.mocked(updateApplicationStatusAction).mockResolvedValueOnce({
      num: 7,
      status: 'applied',
    } as Awaited<ReturnType<typeof updateApplicationStatusAction>>);
    const { result } = renderHook(() => useUpdateApplicationStatus(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.mutate({ num: 7, status: 'applied' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
