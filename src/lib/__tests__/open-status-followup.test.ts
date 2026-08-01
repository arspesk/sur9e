import { beforeEach, describe, expect, it } from 'vitest';
import { useModalStore } from '@/stores/modal-store';
import { openStatusFollowup } from '../open-status-followup';

describe('openStatusFollowup', () => {
  beforeEach(() => {
    useModalStore.setState({ modal: null, context: null });
  });

  it('opens interview preparation for an interview-prep directive', () => {
    openStatusFollowup({ num: 1001, jobKind: 'interview-prep' });

    expect(useModalStore.getState().modal).toBe('interview-process');
    expect(useModalStore.getState().context).toEqual({ num: 1001, statusFollowup: true });
  });

  it('opens negotiation preparation for a negotiate directive', () => {
    openStatusFollowup({ num: 1002, jobKind: 'negotiate' });

    expect(useModalStore.getState().modal).toBe('negotiate');
    expect(useModalStore.getState().context).toEqual({ num: 1002, statusFollowup: true });
  });

  it('leaves the current modal state unchanged for null', () => {
    useModalStore.getState().open('research', { num: 1003 });

    openStatusFollowup(null);

    expect(useModalStore.getState().modal).toBe('research');
    expect(useModalStore.getState().context).toEqual({ num: 1003 });
  });
});
