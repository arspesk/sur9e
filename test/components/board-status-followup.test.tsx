import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/toast/toast-store';
import { Board } from '@/features/pipeline/board';
import type { ApplicationRow } from '@/features/table/table-types';
import { openStatusFollowup } from '@/lib/open-status-followup';
import { updateApplicationStatusAction } from '@/server/actions/applications';
import { useModalStore } from '@/stores/modal-store';

vi.mock('@/server/actions/applications', () => ({
  updateApplicationStatusAction: vi.fn(),
}));

vi.mock('@/lib/open-status-followup', () => ({
  openStatusFollowup: vi.fn(),
}));

vi.mock('@/features/pipeline/board-column', () => ({
  BoardColumn: ({
    column,
    items,
    onCardDragStart,
    onColumnDrop,
  }: {
    column: { key: string; label: string };
    items: ApplicationRow[];
    onCardDragStart: (event: React.DragEvent<HTMLButtonElement>, num: number) => void;
    onColumnDrop: (event: React.DragEvent<HTMLButtonElement>, status: string) => void;
  }) => (
    <section>
      <button
        type="button"
        data-testid={`drop-${column.key}`}
        data-items={items.map(row => row.num).join(',')}
        onDrop={event => onColumnDrop(event, column.key)}
      >
        {column.label}
      </button>
      {items.map(row => (
        <button
          type="button"
          key={row.num}
          data-testid={`drag-${row.num}`}
          draggable
          onDragStart={event => onCardDragStart(event, row.num)}
        >
          {row.company}
        </button>
      ))}
    </section>
  ),
}));

const row: ApplicationRow = {
  num: 7,
  date: '2026-07-31',
  company: 'Acme',
  role: 'Engineer',
  score: '4.5',
  status: 'Responded',
  pdf: '-',
  reportPath: null,
  notes: '',
};

function renderBoard(rows: ApplicationRow[] = [row]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return render(
    <Board
      rows={rows}
      statusFilter={[]}
      filtersActive={false}
      dimOtherKey={null}
      onCardClick={() => {}}
      onCardDoubleClick={() => {}}
      onCardActionsClick={() => {}}
      resetKey="all"
    />,
    { wrapper },
  );
}

function dropCard(status: string) {
  fireEvent.dragStart(screen.getByTestId('drag-7'));
  fireEvent.drop(screen.getByTestId(`drop-${status}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  useModalStore.setState({ modal: null, context: null });
});

describe('Board status follow-ups', () => {
  it('opens the exact server-returned follow-up after a successful single-card drop', async () => {
    const followup = { num: 7, jobKind: 'interview-prep' } as const;
    vi.mocked(updateApplicationStatusAction).mockResolvedValueOnce({
      updated: { num: 7, status: 'Interview' },
      followup,
    } as Awaited<ReturnType<typeof updateApplicationStatusAction>>);
    renderBoard();

    dropCard('interview');

    await waitFor(() => expect(openStatusFollowup).toHaveBeenCalledWith(followup));
    expect(updateApplicationStatusAction).toHaveBeenCalledWith({ num: 7, status: 'interview' });
    expect(openStatusFollowup).toHaveBeenCalledTimes(1);
  });

  it('does not open a follow-up when the status action rejects and rolls the card back', async () => {
    vi.mocked(updateApplicationStatusAction).mockRejectedValueOnce(
      new Error('status write failed'),
    );
    renderBoard();

    dropCard('interview');

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ tone: 'danger', message: 'status write failed' }),
      ]),
    );
    expect(openStatusFollowup).not.toHaveBeenCalled();
    expect(screen.getByTestId('drop-responded')).toHaveAttribute('data-items', '7');
    expect(screen.getByTestId('drop-interview')).toHaveAttribute('data-items', '');
  });

  it('keeps a same-column drop as a no-op', () => {
    renderBoard();

    dropCard('responded');

    expect(updateApplicationStatusAction).not.toHaveBeenCalled();
    expect(openStatusFollowup).not.toHaveBeenCalled();
  });

  it('persists Evaluated before opening its optional evaluation follow-up', async () => {
    vi.mocked(updateApplicationStatusAction).mockResolvedValueOnce({
      updated: { num: 7, status: 'Evaluated' },
      followup: null,
    } as Awaited<ReturnType<typeof updateApplicationStatusAction>>);
    renderBoard();

    dropCard('evaluated');

    await waitFor(() =>
      expect(updateApplicationStatusAction).toHaveBeenCalledWith({
        num: 7,
        status: 'evaluated',
      }),
    );
    expect(openStatusFollowup).not.toHaveBeenCalled();
    await waitFor(() => expect(useModalStore.getState().modal).toBe('evaluate'));
    expect(useModalStore.getState().context).toEqual(
      expect.objectContaining({ num: 7, statusFollowup: true }),
    );
  });
});
