/**
 * test/components/loading-modal-card.test.tsx
 *
 * Render tests for the job-progress card:
 *   - Progress fill is TIME-based: elapsed over the registry's estimateS
 *     (outreach = 600s), capped at 96% — not the old log-regex phases.
 *   - The collapsed card shows the same pulsing FunnyPrompt (inline variant,
 *     spinner included) as the expanded body — not a static grey label.
 *
 * fetch is stubbed (no real /api/jobs, nothing written to data/) with a
 * running snapshot whose startedAt is 150s in the past → expected fill
 * round(150/600 × 100) = 25% once the 1s elapsed tick fires.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingModalHost } from '@/components/loading-modal/loading-modal';
import { useLoadingModalStore } from '@/components/loading-modal/loading-modal-store';

const JOB_ID = 'aaaaaaaaaaaaaaaa';

function runningSnapshot() {
  return {
    status: 'running',
    output: '[1/2] Running outreach research for offer #1 (streaming live)\n',
    startedAt: new Date(Date.now() - 150_000).toISOString(),
    finishedAt: null,
    params: { num: 1 },
  };
}

function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LoadingModalHost />
    </QueryClientProvider>,
  );
}

describe('loading-modal card (running job)', () => {
  beforeEach(() => {
    // jsdom has no ResizeObserver — the header's TruncatableTitle needs one.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => runningSnapshot(),
      })),
    );
  });

  afterEach(() => {
    act(() => {
      useLoadingModalStore.getState().dismiss(JOB_ID);
    });
    vi.unstubAllGlobals();
  });

  it('fills the top progress bar from elapsed/estimateS, in the accent fill class', async () => {
    await act(async () => {
      useLoadingModalStore.getState().startJob(JOB_ID, 'reach-out', 1);
    });
    const { container } = renderHost();
    // elapsed ticks on a 1s interval — wait for the first tick to land.
    await waitFor(
      () => {
        const fill = container.querySelector<HTMLElement>('.loading-modal__progress-fill');
        expect(fill).toBeTruthy();
        // 150s into a 600s outreach estimate → 25% (the tick may add ~1s).
        const width = Number.parseFloat(fill!.style.width);
        expect(width).toBeGreaterThanOrEqual(25);
        expect(width).toBeLessThanOrEqual(27);
        // Running fill carries NO terminal class — base accent background.
        expect(fill!.classList.contains('is-done')).toBe(false);
        expect(fill!.classList.contains('is-error')).toBe(false);
      },
      { timeout: 4000 },
    );
  });

  it('collapsed card shows the inline FunnyPrompt (spinner + pulse), not a grey label', async () => {
    await act(async () => {
      useLoadingModalStore.getState().startJob(JOB_ID, 'reach-out', 1);
      useLoadingModalStore.getState().toggleCollapse(JOB_ID);
    });
    const { container } = renderHost();
    await waitFor(() => {
      const card = container.querySelector('.loading-modal-card');
      expect(card?.getAttribute('data-collapsed')).toBe('true');
      const inline = card?.querySelector('.loading-modal__funny--inline');
      expect(inline).toBeTruthy();
      // Spinner rides with the prompt line in the collapsed header too.
      expect(inline?.querySelector('.loading-modal__spinner')).toBeTruthy();
      // The old static grey phase label is gone.
      expect(card?.querySelector('.loading-modal__sub')).toBeNull();
    });
  });
});
