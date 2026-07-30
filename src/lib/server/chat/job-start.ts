import 'server-only';
import type { JobType } from '../../schemas/jobs';
import {
  type JobConflictPayload,
  type JobRecord,
  type JobSetupRequiredPayload,
  startJob,
} from '../jobs';

type ChatJobStartResult = JobRecord | JobConflictPayload | JobSetupRequiredPayload;

/**
 * Chat keeps screening and evaluation as separate jobs. `screen-evaluate`
 * remains the compact MCP request for an explicitly requested pair, but is
 * expanded here into a screen job whose successful completion queues a
 * separate evaluation job.
 */
export function startChatJob(
  root: string,
  kind: JobType,
  params?: Record<string, unknown>,
): ChatJobStartResult {
  const {
    then: _untrustedThen,
    next_job_id: _untrustedNextJobId,
    continuation_error: _untrustedContinuationError,
    ...safeParams
  } = params ?? {};
  if (kind !== 'screen-evaluate') return startJob(root, { kind, params: safeParams });
  return startJob(root, {
    kind: 'screen',
    params: { ...safeParams, then: 'evaluate' },
  });
}
