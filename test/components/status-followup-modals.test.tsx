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

  it('labels EvaluateModal dismissal Not now while preserving Set status only', () => {
    const onStatusOnly = vi.fn();
    renderModal('evaluate', <EvaluateModal />, { num: 7, patchToEvaluated: true, onStatusOnly });

    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set status only' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(useModalStore.getState().modal).toBeNull();
    expect(onStatusOnly).not.toHaveBeenCalled();
    expect(updateApplicationStatusAction).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
  });

  it('keeps EvaluateModal dismissal Cancel for manual use', () => {
    renderModal('evaluate', <EvaluateModal />, { num: 7 });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });
});
