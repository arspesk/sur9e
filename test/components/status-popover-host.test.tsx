import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusPopoverHost } from '@/components/status-popover-host';
import { useModalStore } from '@/stores/modal-store';
import { useStatusPopoverStore } from '@/stores/status-popover-store';

const mutateStatus = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-applications', () => ({
  useUpdateApplicationStatus: () => ({ mutate: mutateStatus }),
}));

vi.mock('@/components/status-popover', () => ({
  StatusPopover: ({ onPick }: { onPick: (status: 'evaluated') => void }) => (
    <button type="button" onClick={() => onPick('evaluated')}>
      Evaluated
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useModalStore.setState({ modal: null, context: null });
  useStatusPopoverStore.setState({ open: null });
});

describe('StatusPopoverHost evaluated follow-up', () => {
  function openPopover() {
    useStatusPopoverStore.getState().show({
      anchor: document.createElement('button'),
      num: 7,
      currentStatus: 'Screened',
    });
    render(<StatusPopoverHost />);
  }

  it('opens evaluation only after the Evaluated status save succeeds', () => {
    mutateStatus.mockImplementation((_input, options) => options?.onSuccess?.());
    openPopover();

    fireEvent.click(screen.getByRole('button', { name: 'Evaluated' }));

    expect(mutateStatus).toHaveBeenCalledWith(
      { num: 7, status: 'evaluated' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(useModalStore.getState()).toEqual(
      expect.objectContaining({
        modal: 'evaluate',
        context: { num: 7, statusFollowup: true },
      }),
    );
  });

  it('does not open evaluation when the status save fails', () => {
    mutateStatus.mockImplementation(() => undefined);
    openPopover();

    fireEvent.click(screen.getByRole('button', { name: 'Evaluated' }));

    expect(mutateStatus).toHaveBeenCalledOnce();
    expect(useModalStore.getState().modal).toBeNull();
  });
});
