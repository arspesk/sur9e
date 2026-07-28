'use server';

// startJobAction — thin Server Action wrapper around the shared startJob
// library function (src/lib/server/jobs/start.ts). The chat confirm
// executor (src/lib/server/chat/confirms.ts) calls the same startJob, so
// web buttons and chat-approved actions share one validated code path.
//
// No revalidatePath here: createJob writes data/jobs/<id>.json (which
// RSC pages don't read; the client polls /api/jobs/[id]). The spawned
// shell may later write data/applications.md out-of-band; the table's
// own polling picks that up. Revalidating /table here would fire
// BEFORE the shell finished — no-op at best, stale-cache trap at worst.

// A 'use server' module may only export async Server Actions — re-exporting
// types from here (even `export type {…}`) makes Turbopack emit a runtime
// reference that throws `ReferenceError` on cold compile and breaks every
// action on first call. Consumers import these types from '@/lib/server/jobs'
// directly instead.
import { ROOT } from '@/lib/root';
import {
  cancelJob,
  type JobConflictPayload,
  type JobRecord,
  type JobSetupRequiredPayload,
  type StartJobInput,
  startJob,
} from '@/lib/server/jobs';

export async function startJobAction(
  input: StartJobInput,
): Promise<JobRecord | JobConflictPayload | JobSetupRequiredPayload> {
  return startJob(ROOT, input);
}

export async function cancelJobAction(jobId: string) {
  return cancelJob(ROOT, jobId);
}
