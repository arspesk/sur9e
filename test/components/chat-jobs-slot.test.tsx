/**
 * test/components/chat-jobs-slot.test.tsx
 *
 * Render tests for the chat jobs strip:
 *   - Progress fill is TIME-based: elapsed over the registry's estimateS
 *     (reach-out = 600s), capped at 96%.
 *   - ‹ i/N › arrows cycle the active row when >1 job is tracked.
 *   - Logs pane is opt-in (collapsed by default).
 *   - Terminal done state shows ✓ + "View report".
 *   - Status transitions are announced via an aria-live region.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { confirmCancelMock } = vi.hoisted(() => ({
  confirmCancelMock: vi.fn(),
}));

vi.mock('@/components/delete-confirm-modal', () => ({
  useDeleteConfirmStore: (selector: (state: { confirm: typeof confirmCancelMock }) => unknown) =>
    selector({ confirm: confirmCancelMock }),
}));

// ChatJobsSlot now imports the startJobAction server action (for the failed-row
// Retry). Mock it so the test stays a pure unit and the transitive `server-only`
// import chain never loads — same guard as test/use-job-action.test.tsx.
vi.mock('@/server/actions/jobs', () => ({
  cancelJobAction: vi.fn(),
  startJobAction: vi.fn(),
}));

import { useToastStore } from '@/components/toast/toast-store';
import { ChatJobsSlot } from '@/features/chat/chat-jobs-slot';
import { useChatJobsStore } from '@/features/chat/chat-jobs-store';
import { cancelJobAction, startJobAction } from '@/server/actions/jobs';

const mockStartJobAction = vi.mocked(startJobAction);
const mockCancelJobAction = vi.mocked(cancelJobAction);

function resetStore() {
  const s = useChatJobsStore.getState();
  for (const id of [...s.order]) s.dismiss(id);
}

afterEach(() => {
  act(resetStore);
  mockStartJobAction.mockReset();
  mockCancelJobAction.mockReset();
  confirmCancelMock.mockReset();
  useToastStore.setState({ toasts: [] });
});

function jobRecord(id: string) {
  return {
    id,
    type: 'cover-letter' as const,
    status: 'queued' as const,
    params: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    output: '',
    error: null,
    exitCode: null,
  };
}

function seedRunning(jobId: string, kind: string, num: number, elapsedS: number) {
  act(() => {
    useChatJobsStore.getState().startJob(jobId, kind, num);
    useChatJobsStore.getState().setSnapshot(jobId, {
      status: 'running',
      output: '[1/2] working…\n',
      startedAt: new Date(Date.now() - elapsedS * 1000).toISOString(),
      finishedAt: null,
      params: { num },
    });
  });
}

describe('ChatJobsSlot', () => {
  it('renders nothing with no tracked jobs', () => {
    const { container } = render(<ChatJobsSlot />);
    expect(container.querySelector('.chat-jobs')).toBeNull();
  });

  it('fills the 2px progress bar from elapsed/estimateS', async () => {
    seedRunning('job-1', 'reach-out', 1, 150); // 150/600 → 25%
    const { container } = render(<ChatJobsSlot />);
    await waitFor(() => {
      const fill = container.querySelector<HTMLElement>('.chat-jobs__progress-fill');
      expect(fill).toBeTruthy();
      const width = Number.parseFloat(fill!.style.width);
      expect(width).toBeGreaterThanOrEqual(25);
      expect(width).toBeLessThanOrEqual(27);
      expect(fill!.classList.contains('is-done')).toBe(false);
      expect(fill!.classList.contains('is-error')).toBe(false);
    });
    expect(container.querySelector('.chat-jobs__title')?.textContent).toBe('Reach out · #1');
    expect(container.querySelector('.chat-jobs__spinner')).toBeTruthy();
    // Logs collapsed by default.
    expect(container.querySelector('.chat-jobs__logs')).toBeNull();
  });

  it('cycles the active row with the ‹ › arrows when >1 job', async () => {
    seedRunning('job-1', 'evaluate', 1, 30);
    seedRunning('job-2', 'research', 2, 30);
    const { container, getByLabelText } = render(<ChatJobsSlot />);
    await waitFor(() => {
      expect(container.querySelector('.chat-jobs__nav-count')?.textContent).toBe('2/2');
      expect(container.querySelector('.chat-jobs__title')?.textContent).toBe('Research · #2');
    });
    fireEvent.click(getByLabelText('Next job'));
    await waitFor(() => {
      expect(container.querySelector('.chat-jobs__title')?.textContent).toBe('Evaluate · #1');
      expect(container.querySelector('.chat-jobs__nav-count')?.textContent).toBe('1/2');
    });
  });

  it('logs disclosure opens the mono pane with parsed lines', async () => {
    seedRunning('job-1', 'evaluate', 1, 30);
    const { container, getByLabelText } = render(<ChatJobsSlot />);
    fireEvent.click(getByLabelText('Show logs'));
    await waitFor(() => {
      const pre = container.querySelector('.chat-jobs__logs pre');
      expect(pre?.textContent).toContain('[1/2] working…');
    });
  });

  it('confirms and cancels the exact running job from the icon beside Logs', async () => {
    seedRunning('job-1', 'evaluate', 1, 30);
    confirmCancelMock.mockResolvedValue(true);
    mockCancelJobAction.mockResolvedValue({
      cancelled: true,
      job: { ...jobRecord('job-1'), status: 'cancelled' },
    });
    const { getByLabelText } = render(<ChatJobsSlot />);

    fireEvent.click(getByLabelText('Cancel Evaluate · #1'));

    await waitFor(() => {
      expect(confirmCancelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cancel job?',
          confirmLabel: 'Cancel job',
        }),
      );
      expect(mockCancelJobAction).toHaveBeenCalledWith('job-1');
      expect(useChatJobsStore.getState().jobs['job-1'].snapshot?.status).toBe('cancelled');
    });
  });

  it('surfaces a cancellation failure and keeps the running job actionable', async () => {
    seedRunning('job-1', 'evaluate', 1, 30);
    confirmCancelMock.mockResolvedValue(true);
    mockCancelJobAction.mockRejectedValue(new Error('Cancellation service unavailable'));
    const { getByLabelText } = render(<ChatJobsSlot />);

    fireEvent.click(getByLabelText('Cancel Evaluate · #1'));

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          tone: 'danger',
          message: 'Cancellation service unavailable',
        }),
      ]);
      expect(getByLabelText('Cancel Evaluate · #1')).not.toBeDisabled();
      expect(useChatJobsStore.getState().jobs['job-1'].snapshot?.status).toBe('running');
    });
  });

  it('renders cancelled as a distinct neutral state with logs and Dismiss but no Retry', async () => {
    act(() => {
      useChatJobsStore.getState().startJob('job-c', 'evaluate', 7);
      useChatJobsStore.getState().setSnapshot('job-c', {
        status: 'cancelled',
        output: 'partial output',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        finishedAt: new Date().toISOString(),
        params: { num: 7 },
      });
    });
    const { container, getByText, queryByText } = render(<ChatJobsSlot />);
    expect(container.querySelector('.chat-jobs__cancelled')).toBeTruthy();
    expect(getByText('Cancelled')).toBeTruthy();
    expect(getByText('Dismiss')).toBeTruthy();
    expect(queryByText('Retry')).toBeNull();
    expect(container.querySelector('.chat-jobs__logs-toggle')).toBeTruthy();
  });

  it('done state shows ✓ + View report and dismisses on ×', async () => {
    act(() => {
      useChatJobsStore.getState().startJob('job-d', 'evaluate', 7);
      useChatJobsStore.getState().setSnapshot('job-d', {
        status: 'done',
        output: '',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        finishedAt: new Date().toISOString(),
        params: { num: 7 },
      });
    });
    const { container, getByText, getByLabelText } = render(<ChatJobsSlot />);
    await waitFor(() => {
      expect(container.querySelector('.chat-jobs__check')).toBeTruthy();
      expect(getByText('View report')).toBeTruthy();
      const fill = container.querySelector<HTMLElement>('.chat-jobs__progress-fill');
      expect(fill?.classList.contains('is-done')).toBe(true);
      expect(fill?.style.width).toBe('100%');
    });
    fireEvent.click(getByLabelText('Dismiss'));
    await waitFor(() => {
      expect(container.querySelector('.chat-jobs')).toBeNull();
    });
  });

  it('shows a clean error cause and a sanitized log pane on failure', async () => {
    // A raw, escape-laden dump exactly like a failed mode run persists: ANSI
    // codes, a leaked `<<<SUR9E_*>>>` envelope, and an HTML 404-page tail.
    const rawOutput = [
      'mode=cover-letter provider=claude model=claude-opus (resolved from mode_default)',
      '\x1b[2m[1/1] generating…\x1b[0m',
      '<<<SUR9E_OUTPUT>>>',
      '<!DOCTYPE html>',
      '<html><head><title>404 Not Found</title></head>',
      '<body>The requested URL was not found on this server.</body>',
      '</html>',
      '<<<SUR9E_END>>>',
      '\x1b[31m❌ output parse failed on retry: no <<<SUR9E_OUTPUT>>> sentinel in response\x1b[0m',
    ].join('\n');
    // A dirty error string (belt-and-suspenders: the runner writes a clean one,
    // but the poll layer's 404 path and legacy records can set a raw value).
    const rawError = '\x1b[31m❌ no <<<SUR9E_OUTPUT>>> sentinel in response\x1b[0m';

    act(() => {
      useChatJobsStore.getState().startJob('job-err', 'cover-letter', 4);
      useChatJobsStore.getState().setSnapshot('job-err', {
        status: 'error',
        output: rawOutput,
        error: rawError,
        startedAt: new Date(Date.now() - 30_000).toISOString(),
        finishedAt: new Date().toISOString(),
        params: { num: 4 },
      });
    });
    const { container, getByLabelText } = render(<ChatJobsSlot />);

    // Error <p>: a clean human cause — no ANSI, no sentinels, and NOT bare 'exit N'.
    await waitFor(() => {
      expect(container.querySelector('.chat-jobs__error')).toBeTruthy();
    });
    const errText = container.querySelector('.chat-jobs__error')?.textContent ?? '';
    expect(errText).toContain('sentinel in response');
    expect(errText).not.toMatch(/^exit \d+$/);
    expect(errText).not.toContain('<<<SUR9E');
    expect(errText).not.toMatch(/\x1b/);

    // Logs <pre>: no ANSI, no sentinel lines, no HTML-page tail lines.
    fireEvent.click(getByLabelText('Show logs'));
    await waitFor(() => {
      expect(container.querySelector('.chat-jobs__logs pre')).toBeTruthy();
    });
    const preText = container.querySelector('.chat-jobs__logs pre')?.textContent ?? '';
    expect(preText).toContain('mode=cover-letter'); // useful progress line kept
    expect(preText).toContain('generating'); // ANSI stripped, line kept
    expect(preText).not.toContain('<<<SUR9E');
    expect(preText).not.toMatch(/\x1b/);
    expect(preText).not.toContain('<!DOCTYPE');
    expect(preText).not.toContain('<html');
    expect(preText).not.toContain('</html>');
    expect(preText).not.toContain('<body');
  });

  it('renders the auth template for a job the runner classified as auth (issue #120)', async () => {
    act(() => {
      useChatJobsStore.getState().startJob('job-auth', 'cover-letter', 6);
      useChatJobsStore.getState().setSnapshot('job-auth', {
        status: 'error',
        output: 'Failed to authenticate: OAuth session expired and could not be refreshed',
        error:
          'Your Claude session has expired or is signed out — run "claude auth login" in a terminal, then try again.',
        errorCategory: 'auth',
        provider: 'claude',
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        finishedAt: new Date().toISOString(),
        params: { num: 6 },
      });
    });
    const { container } = render(<ChatJobsSlot />);
    await waitFor(() => expect(container.querySelector('.chat-jobs__error')).toBeTruthy());
    const errText = container.querySelector('.chat-jobs__error')?.textContent ?? '';
    expect(errText).toContain('claude auth login');
    expect(errText).not.toContain('rate limit or quota');
  });

  it('classifies a legacy/raw provider error string itself (no errorCategory) instead of leaking it', async () => {
    // Records written before the runner humanized failures — or set raw by the
    // poll layer — still get the same "log back in" line, never the raw text.
    act(() => {
      useChatJobsStore.getState().startJob('job-legacy', 'cover-letter', 7);
      useChatJobsStore.getState().setSnapshot('job-legacy', {
        status: 'error',
        output: '',
        error: 'Failed to authenticate: OAuth session expired and could not be refreshed (exit 1)',
        provider: 'claude',
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        finishedAt: new Date().toISOString(),
        params: { num: 7 },
      });
    });
    const { container } = render(<ChatJobsSlot />);
    await waitFor(() => expect(container.querySelector('.chat-jobs__error')).toBeTruthy());
    const errText = container.querySelector('.chat-jobs__error')?.textContent ?? '';
    expect(errText).toContain('claude auth login');
    expect(errText).not.toContain('could not be refreshed');
  });

  it('Retry re-spawns the same mode with the same params and swaps in the fresh job', async () => {
    mockStartJobAction.mockResolvedValue(jobRecord('freshjob00000000'));
    act(() => {
      useChatJobsStore.getState().startJob('job-fail', 'cover-letter', 5);
      useChatJobsStore.getState().setSnapshot('job-fail', {
        status: 'error',
        output: '❌ artifact write failed: ENOSPC',
        error: 'artifact write failed: ENOSPC (exit 1)',
        startedAt: new Date(Date.now() - 20_000).toISOString(),
        finishedAt: new Date().toISOString(),
        params: { num: 5 },
      });
    });
    const { getByText } = render(<ChatJobsSlot />);

    await waitFor(() => expect(getByText('Retry')).toBeTruthy());
    fireEvent.click(getByText('Retry'));

    // Re-spawns the SAME mode + params through the canonical start path.
    await waitFor(() =>
      expect(mockStartJobAction).toHaveBeenCalledWith({
        kind: 'cover-letter',
        params: { num: 5 },
      }),
    );
    // Clean swap: failed row dropped, fresh job tracked.
    await waitFor(() => {
      const s = useChatJobsStore.getState();
      expect(s.jobs['job-fail']).toBeUndefined();
      expect(s.jobs.freshjob00000000).toBeTruthy();
    });
  });

  it('announces terminal state changes via an aria-live region', async () => {
    act(() => {
      useChatJobsStore.getState().startJob('job-live', 'evaluate', 3);
      useChatJobsStore.getState().setSnapshot('job-live', {
        status: 'running',
        output: '',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        params: { num: 3 },
      });
    });
    const { container } = render(<ChatJobsSlot />);
    const live = container.querySelector('[aria-live]');
    expect(live).toBeTruthy();
    act(() => {
      useChatJobsStore.getState().setSnapshot('job-live', {
        status: 'done',
        output: '',
        startedAt: new Date(Date.now() - 5000).toISOString(),
        finishedAt: new Date().toISOString(),
        params: { num: 3 },
      });
    });
    await waitFor(() => {
      expect(container.querySelector('[aria-live]')?.textContent).toMatch(
        /finished|done|complete/i,
      );
    });
  });
});
