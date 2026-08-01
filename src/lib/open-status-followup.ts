import type { StatusFollowup } from '@/lib/status-transitions';
import { type ModalName, useModalStore } from '@/stores/modal-store';

const FOLLOWUP_MODAL_BY_JOB_KIND: Record<StatusFollowup['jobKind'], Exclude<ModalName, null>> = {
  'interview-prep': 'interview-process',
  negotiate: 'negotiate',
};

export function openStatusFollowup(followup: StatusFollowup | null): void {
  if (!followup) return;
  useModalStore.getState().open(FOLLOWUP_MODAL_BY_JOB_KIND[followup.jobKind], {
    num: followup.num,
    statusFollowup: true,
  });
}
