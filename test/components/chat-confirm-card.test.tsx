import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => vi.unstubAllGlobals());

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
    await findByText('✓ Confirmed');
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
    expect(getByText('✓ Started — running in the jobs strip')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('varies the approved label by action kind (set-status / edit-report)', () => {
    const status = render(
      <ConfirmCard
        token="s"
        summary="Set #12 to applied"
        meta=""
        outcome="approved"
        action="set-status"
      />,
    );
    expect(status.getByText('✓ Status updated')).toBeTruthy();

    const report = render(
      <ConfirmCard
        token="r"
        summary="Edit report #12"
        meta=""
        outcome="approved"
        action="edit-report"
      />,
    );
    expect(report.getByText('✓ Report updated')).toBeTruthy();
  });

  it('an approved card with no action kind falls back to a generic Confirmed label', () => {
    const { getByText, queryByRole } = render(
      <ConfirmCard token="tok1" summary="Start evaluation for #12" meta="" outcome="approved" />,
    );
    expect(getByText('✓ Confirmed')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('cancelled outcome renders its own distinct label', () => {
    const { getByText, queryByRole } = render(
      <ConfirmCard token="tok1" summary="Start evaluation for #12" meta="" outcome="cancelled" />,
    );
    expect(getByText('✕ Cancelled')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('expired outcome renders a distinct expired label, not mislabeled as Cancelled', () => {
    const { getByText, queryByText, queryByRole } = render(
      <ConfirmCard token="tok1" summary="Start evaluation for #12" meta="" outcome="expired" />,
    );
    expect(getByText('⃠ Expired')).toBeTruthy();
    expect(queryByText('✕ Cancelled')).toBeNull();
    expect(queryByRole('button')).toBeNull();
  });
});
