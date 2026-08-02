import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaluateModal } from '@/components/modals/evaluate-modal';
import { InterviewProcessModal } from '@/components/modals/interview-process-modal';
import { NegotiateModal } from '@/components/modals/negotiate-modal';
import { updateApplicationStatusAction } from '@/server/actions/applications';
import { useModalStore } from '@/stores/modal-store';

const runJob = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-job-action', () => ({
  useJobAction: () => ({ run: runJob }),
}));

vi.mock('@/server/actions/applications', () => ({
  updateApplicationStatusAction: vi.fn(),
}));

function renderModal(
  modal: 'evaluate' | 'interview-process' | 'negotiate',
  component: ReactNode,
  context: Record<string, unknown>,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useModalStore.setState({ modal, context });
  return render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useModalStore.setState({ modal: null, context: null });
});

describe('status follow-up modal copy', () => {
  it('labels InterviewProcessModal dismissal Not now for a status follow-up', () => {
    renderModal('interview-process', <InterviewProcessModal />, { num: 7, statusFollowup: true });

    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('keeps InterviewProcessModal dismissal Cancel for manual use', () => {
    renderModal('interview-process', <InterviewProcessModal />, { num: 7 });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('labels NegotiateModal dismissal Not now for a status follow-up', () => {
    renderModal('negotiate', <NegotiateModal />, { num: 7, statusFollowup: true });

    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('keeps NegotiateModal dismissal Cancel for manual use', () => {
    renderModal('negotiate', <NegotiateModal />, { num: 7 });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('treats EvaluateModal as an optional follow-up after status is already saved', () => {
    renderModal('evaluate', <EvaluateModal />, { num: 7, statusFollowup: true });

    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set status only' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(useModalStore.getState().modal).toBeNull();
    expect(updateApplicationStatusAction).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
  });

  it('runs evaluation without attempting a second status write', () => {
    renderModal('evaluate', <EvaluateModal />, { num: 7, statusFollowup: true });

    fireEvent.click(screen.getByRole('button', { name: 'Run evaluation' }));

    expect(updateApplicationStatusAction).not.toHaveBeenCalled();
    expect(runJob).toHaveBeenCalledWith({ num: 7 });
  });

  it('labels bulk status-triggered EvaluateModal dismissal Not now', () => {
    renderModal('evaluate', <EvaluateModal />, {
      count: 2,
      nums: [7, 8],
      statusFollowup: true,
    });

    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set status only' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('keeps EvaluateModal dismissal Cancel for a manual batch', () => {
    renderModal('evaluate', <EvaluateModal />, { count: 2, nums: [7, 8] });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });
});
