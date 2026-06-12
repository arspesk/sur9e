// components/modals/batch-run.ts
//
// Shared bulk fan-out for generator confirm modals: run one job per offer
// num in parallel and summarize. Mirrors the evaluate-modal batch branch.

import type { JobActionResult } from '@/hooks/use-job-action';

export async function runForNums(
  run: (params: Record<string, unknown>) => Promise<JobActionResult>,
  nums: number[],
  // Build the per-offer job payload. Defaults to `{ num }`; callers that
  // forward extra flags (e.g. evaluate's generate_pdf) supply their own.
  buildParams: (num: number) => Record<string, unknown> = num => ({ num }),
): Promise<{ done: number; failed: number }> {
  const results = await Promise.allSettled(nums.map(n => run(buildParams(n))));
  const done = results.filter(r => r.status === 'fulfilled' && r.value.done === 1).length;
  return { done, failed: nums.length - done };
}
