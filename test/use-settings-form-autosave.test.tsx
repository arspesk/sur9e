// Regression: programmatic setValue edits (the schedule preset controls)
// MUST schedule an auto-save. Two historical blockers, both fixed:
//  1. `if (!type) return` in the watch callback — RHF fires watch with
//     type === undefined for setValue, so preset edits never saved.
//  2. `if (!form.formState.isValid) return` in the debounce — formState is
//     a Proxy that stays inert (false) when read outside render.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsForm } from '@/features/settings/hooks/use-settings-form';

vi.mock('@/server/actions/settings', () => ({
  saveSettingsAction: vi.fn(),
}));

import { saveSettingsAction } from '@/server/actions/settings';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(saveSettingsAction).mockResolvedValue({ ok: true, settings: {} } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('settings auto-save', () => {
  it('a programmatic setValue (schedule preset path) schedules a save', async () => {
    const { result } = renderHook(() => useSettingsForm(), { wrapper });

    act(() => {
      result.current.form.setValue('scanning.schedule.cron', '0 10 * * *', {
        shouldValidate: true,
        shouldDirty: true,
      });
    });

    // Debounce is 600ms — advance past it and flush the async commit.
    // (advanceTimersByTimeAsync flushes microtasks between timer steps;
    // waitFor would deadlock under fake timers.)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(saveSettingsAction).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(saveSettingsAction).mock.calls[0][0] as Record<string, never>;
    expect((payload.scanning as { schedule?: { cron?: string } } | undefined)?.schedule?.cron).toBe(
      '0 10 * * *',
    );
  });

  it('an INVALID payload never reaches the wire (zod gate, not formState.isValid)', async () => {
    const { result } = renderHook(() => useSettingsForm(), { wrapper });

    act(() => {
      result.current.form.setValue('scanning.schedule.cron', 'not a cron', {
        shouldValidate: true,
        shouldDirty: true,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(saveSettingsAction).not.toHaveBeenCalled();
  });

  it('a save queued within the debounce window flushes on unmount (client-side nav)', async () => {
    const { result, unmount } = renderHook(() => useSettingsForm(), { wrapper });

    act(() => {
      result.current.form.setValue('scanning.schedule.cron', '0 10 * * *', {
        shouldValidate: true,
        shouldDirty: true,
      });
    });

    // Unmount BEFORE the 600ms debounce fires — App Router navigation does
    // exactly this (no beforeunload). The queued save must flush, not drop.
    await act(async () => {
      unmount();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(saveSettingsAction).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(saveSettingsAction).mock.calls[0][0] as Record<string, never>;
    expect((payload.scanning as { schedule?: { cron?: string } } | undefined)?.schedule?.cron).toBe(
      '0 10 * * *',
    );
  });
});
