import type { StatusFollowup } from '@/lib/status-transitions';
import { useModalStore } from '@/stores/modal-store';

export function openStatusFollowup(followup: StatusFollowup | null): void {
  if (!followup) return;
  useModalStore
    .getState()
    .open(followup.jobKind === 'interview-prep' ? 'interview-process' : 'negotiate', {
      num: followup.num,
      statusFollowup: true,
    });
}
