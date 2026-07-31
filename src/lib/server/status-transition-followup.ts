import 'server-only';
import type { ApplicationRow, ApplicationStatus } from '../schemas/applications';
import { followupForStatusTransition, type StatusFollowup } from '../status-transitions';
import { findByNum, updateStatus } from './applications';
import { findJobConflict } from './jobs/start';

export interface StatusTransitionResult {
  updated: ApplicationRow;
  followup: StatusFollowup | null;
}

export function updateStatusWithFollowup(
  root: string,
  num: number,
  status: ApplicationStatus,
): StatusTransitionResult {
  const before = findByNum(root, num);
  if (!before) throw new Error(`num not found: ${num}`);

  const updated = updateStatus(root, num, status);
  if (!updated) throw new Error(`num not found after status update: ${num}`);

  const followup = followupForStatusTransition(num, before.status, status);
  if (!followup) return { updated, followup: null };

  const after = findByNum(root, num);
  const alreadyComplete =
    (followup.jobKind === 'interview-prep' && after?.has_interview_process) ||
    (followup.jobKind === 'negotiate' && after?.has_negotiation);
  if (alreadyComplete) return { updated, followup: null };

  const conflict = findJobConflict(root, followup.jobKind, { num });
  return { updated, followup: conflict ? null : followup };
}
