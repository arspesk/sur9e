import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/toast/toast-store';
import { useChatJobsStore } from '@/features/chat/chat-jobs-store';
import { ConfirmCard } from '@/features/chat/confirm-card';

// ConfirmCard calls useQueryClient (it invalidates the conversation cache on
// resolve so a close/reopen reflects the persisted outcome), so every render
// must sit under a QueryClientProvider. A fresh, retry-off client per render
// keeps each assertion isolated; naming the wrapper `render` keeps the call
// sites below untouched.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ConfirmCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const store = useChatJobsStore.getState();
    for (const id of [...store.order]) store.dismiss(id);
    useToastStore.setState({ toasts: [] });
  });

  it('primary posts approve:true to the token route, then resolves the card optimistically', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }),
    );
    const { getByRole, findByText, queryByRole } = render(
      <ConfirmCard
        token="tok1"
        summary="Start evaluation for #12"
        meta="~$0.30 · ~4 min"
        outcome="pending"
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Start evaluation for #12' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe('/api/chat/confirms/tok1');
    expect(calls[0].body).toEqual({ approve: true });
    // The confirm-resolved SSE event only fires while the turn stream is still
    // open, but a card is usually resolved AFTER the turn finished — so the card
    // resolves OPTIMISTICALLY from the POST response instead of waiting. A 200
    // with no explicit outcome means 'approved': the Start/Cancel buttons are
    // swapped for the resolved label rather than left disabled.
    await findByText('Confirmed');
    expect(queryByRole('button')).toBeNull();
  });

  it('Cancel posts approve:false', async () => {
    const calls: Array<{ body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ body: JSON.parse(String(init?.body)) });
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }),
    );
    const { getByRole } = render(
      <ConfirmCard token="tok1" summary="Start evaluation for #12" meta="" outcome="pending" />,
    );
    fireEvent.click(getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ approve: false });
  });

  it('a failed POST re-enables the buttons and shows the error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response),
    );
    const { getByRole, findByText } = render(
      <ConfirmCard token="tok1" summary="Start evaluation for #12" meta="" outcome="pending" />,
    );
    fireEvent.click(getByRole('button', { name: 'Start evaluation for #12' }));
    await findByText('Confirm failed (500). Try again.');
    expect((getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('long summaries fall back to the generic Approve label', () => {
    const { getByRole } = render(
      <ConfirmCard
        token="tok1"
        summary="Start a full batch evaluation of every screened offer above the threshold"
        meta=""
        outcome="pending"
      />,
    );
    expect(getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('an approved start-job card tells the user the job kicked off, without buttons', () => {
    const { getByText, queryByRole } = render(
      <ConfirmCard
        token="tok1"
        summary="Start outreach draft for offer #56"
        meta=""
        outcome="approved"
        action="start-job"
      />,
    );
    expect(getByText('Started — running in the jobs strip')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('does not claim a job was cancelled when approval found it already finished', () => {
    const { getByText, queryByText } = render(
      <ConfirmCard
        token="tok1"
        summary="Cancel evaluation for #12"
        meta=""
        outcome="approved"
        execution="unchanged"
        action="cancel-job"
      />,
    );
    expect(getByText('Job already finished')).toBeTruthy();
    expect(queryByText('✓ Job cancelled')).toBeNull();
  });

  it('refreshes offers and registers an optional job after creating a text offer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              outcome: 'approved',
              execution: 'succeeded',
              result: {
                ok: true,
                textOffer: { offer: { num: 42 } },
                job: {
                  id: '0123456789abcdef',
                  type: 'cover-letter',
                  status: 'queued',
                  params: { num: 42 },
                },
              },
            }),
          }) as Response,
      ),
    );
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const { getByRole } = render(
      <ConfirmCard
        token="tok-text"
        summary="Create offer from pasted text"
        meta=""
        outcome="pending"
        action="create-offer-from-text"
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Create offer from pasted text' }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['applications'] });
      expect(useChatJobsStore.getState().jobs['0123456789abcdef']).toMatchObject({
        kind: 'cover-letter',
        num: 42,
      });
    });
  });

  it('invalidates applications/application/report caches after an approved offer update (I-2)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              outcome: 'approved',
              execution: 'succeeded',
              result: {
                ok: true,
                offerUpdate: { num: 12, changed: ['seniority'], bodyEditCount: 0 },
                message: 'Offer #12 updated: seniority.',
              },
            }),
          }) as Response,
      ),
    );
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const { getByRole } = render(
      <ConfirmCard
        token="tok-offer-update"
        summary="Update offer #12"
        meta=""
        outcome="pending"
        action="update-offer"
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Update offer #12' }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['applications'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['application', 12] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['report'] });
    });
  });

  it('invalidates applications/application/report caches after an approved set-status update (I-2)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              outcome: 'approved',
              execution: 'succeeded',
              result: {
                ok: true,
                updated: { num: 12 },
              },
            }),
          }) as Response,
      ),
    );
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const { getByRole } = render(
      <ConfirmCard
        token="tok-set-status"
        summary="Set #12 to applied"
        meta=""
        outcome="pending"
        action="set-status"
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Set #12 to applied' }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['applications'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['application', 12] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['report'] });
    });
  });

  it('shows the completion message and durable offer hyperlink after approval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              outcome: 'approved',
              execution: 'succeeded',
              result: {
                ok: true,
                textOffer: { offer: { num: 42 } },
                message:
                  'Offer #42 created. Screening started; evaluation will start after screening succeeds.',
                links: [{ label: 'Offer #42', href: '/report/42' }],
              },
            }),
          }) as Response,
      ),
    );
    const { getByRole, findByText, findByRole } = render(
      <ConfirmCard
        token="tok-result"
        summary="Create, screen, and evaluate offer"
        meta=""
        outcome="pending"
        action="create-offer-from-text"
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Create, screen, and evaluate offer' }));

    await findByText(
      'Offer #42 created. Screening started; evaluation will start after screening succeeds.',
    );
    expect(await findByRole('link', { name: 'Offer #42' })).toHaveAttribute('href', '/report/42');
  });

  it('registers every initially running child returned by a workflow approval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              outcome: 'approved',
              execution: 'succeeded',
              result: {
                ok: true,
                workflow: { id: 'fedcba9876543210', status: 'running' },
                jobs: [
                  {
                    id: '0123456789abcdef',
                    type: 'evaluate',
                    status: 'queued',
                    params: { num: 42 },
                  },
                  {
                    id: '1111111111111111',
                    type: 'evaluate',
                    status: 'running',
                    params: { num: 43 },
                  },
                ],
              },
            }),
          }) as Response,
      ),
    );
    const { getByRole } = render(
      <ConfirmCard
        token="tok-workflow"
        summary="Run evaluation for 2 targets"
        meta=""
        outcome="pending"
        action="start-workflow"
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Run evaluation for 2 targets' }));

    await waitFor(() => {
      expect(useChatJobsStore.getState().jobs['0123456789abcdef']).toMatchObject({
        kind: 'evaluate',
        num: 42,
      });
      expect(useChatJobsStore.getState().jobs['1111111111111111']).toMatchObject({
        kind: 'evaluate',
        num: 43,
      });
    });
  });

  it('surfaces the server reason when an approved action fails to execute', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              outcome: 'approved',
              execution: 'failed',
              result: { ok: false, error: 'The report changed while this card was open' },
            }),
          }) as Response,
      ),
    );
    const { getByRole, findByText } = render(
      <ConfirmCard
        token="tok-failed"
        summary="Update offer #12"
        meta=""
        outcome="pending"
        action="update-offer"
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Update offer #12' }));

    await findByText('Action failed');
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        tone: 'danger',
        message: 'The report changed while this card was open',
      }),
    ]);
  });

  it('warns when the offer is ready but its optional job could not start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              outcome: 'approved',
              execution: 'succeeded',
              result: {
                ok: true,
                textOffer: { offer: { num: 42 } },
                job: {
                  conflict: true,
                  setupRequired: true,
                  message: 'Finish profile setup before starting cover letter',
                },
              },
            }),
          }) as Response,
      ),
    );
    const { getByRole, findByText } = render(
      <ConfirmCard
        token="tok-partial"
        summary="Create offer and cover letter"
        meta=""
        outcome="pending"
        action="create-offer-from-text"
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Create offer and cover letter' }));

    await findByText('Offer ready');
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        tone: 'warning',
        message: 'Finish profile setup before starting cover letter',
      }),
    ]);
    expect(useChatJobsStore.getState().order).toHaveLength(0);
  });

  it('varies the approved label by action kind (set-status / update-offer)', () => {
    const status = render(
      <ConfirmCard
        token="s"
        summary="Set #12 to applied"
        meta=""
        outcome="approved"
        action="set-status"
      />,
    );
    expect(status.getByText('Status updated')).toBeTruthy();

    const offer = render(
      <ConfirmCard
        token="r"
        summary="Update offer #12"
        meta=""
        outcome="approved"
        action="update-offer"
      />,
    );
    expect(offer.getByText('Offer updated')).toBeTruthy();
  });

  it('an approved card with no action kind falls back to a generic Confirmed label', () => {
    const { getByText, queryByRole } = render(
      <ConfirmCard token="tok1" summary="Start evaluation for #12" meta="" outcome="approved" />,
    );
    expect(getByText('Confirmed')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('cancelled outcome renders its own distinct label', () => {
    const { getByText, queryByRole } = render(
      <ConfirmCard token="tok1" summary="Start evaluation for #12" meta="" outcome="cancelled" />,
    );
    expect(getByText('Cancelled')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('expired outcome renders a distinct expired label, not mislabeled as Cancelled', () => {
    const { getByText, queryByText, queryByRole } = render(
      <ConfirmCard token="tok1" summary="Start evaluation for #12" meta="" outcome="expired" />,
    );
    expect(getByText('Expired')).toBeTruthy();
    expect(queryByText('Cancelled')).toBeNull();
    expect(queryByRole('button')).toBeNull();
  });
});
