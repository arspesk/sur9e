'use server';

// Server Actions for the applications resource. Each action invalidates
// the SSR cache for every surface that shows status/list state
// (/table, /pipeline, /report/[filename]).
//
// /api/applications/* stays as the JSON compatibility surface for
// scripts / curl.

import { z } from 'zod';
import { ROOT } from '@/lib/root';
import { ApplicationStatus } from '@/lib/schemas/applications';
import {
  type ApplicationRow,
  batchDeleteApplications,
  batchUpdateStatus,
  deleteApplication,
  updateStatus,
} from '@/lib/server/applications';
import { reportPathForNum, updateReportFrontmatterField } from '@/lib/server/reports';
import { revalidatePath } from '@/server/revalidate';

const numSchema = z.number().int().positive();
// ApplicationStatus is the canonical enum (lib/schemas/applications);
// 'skip' is preprocessed to 'discarded' before the enum check. Validating
// at the boundary means downstream typed code never sees a stray string.
const statusSchema = ApplicationStatus;

export interface UpdateStatusInput {
  num: number;
  status: ApplicationStatus;
}

export interface DeleteApplicationResult {
  /** false when the row was already gone (idempotent double-delete). */
  deleted: boolean;
  num: number;
  removedReport: string | null;
}

function revalidateApplicationSurfaces() {
  // revalidatePath (not unstable_cache + revalidateTag) because
  // data/applications.md is also rewritten out-of-band by CLI tooling
  // (scan / normalize-statuses / merge-tracker / batch/scan-jobspy);
  // a tag-based cache would mask those writes until something
  // explicitly invalidated it.
  revalidatePath('/offers');
  revalidatePath('/pipeline');
  // Reports render the status pill in the hero — the dynamic segment
  // re-renders on next request.
  revalidatePath('/report/[filename]', 'page');
}

export async function updateApplicationStatusAction(
  input: UpdateStatusInput,
): Promise<ApplicationRow> {
  const num = numSchema.parse(input.num);
  const status = statusSchema.parse(input.status);
  const updated = updateStatus(ROOT, num, status);
  if (!updated) {
    throw new Error(`num not found: ${num}`);
  }
  revalidateApplicationSurfaces();
  return updated;
}

export async function deleteApplicationAction(input: {
  num: number;
}): Promise<DeleteApplicationResult> {
  const num = numSchema.parse(input.num);
  const result = deleteApplication(ROOT, num);
  revalidateApplicationSurfaces();
  return result;
}

export interface BatchUpdateStatusInput {
  nums: number[];
  status: ApplicationStatus;
}

export interface BatchResult {
  ok: number;
  failed: number;
  errors: Array<{ num: number; error: string }>;
}

// Batch variants — one read + atomic write per call (instead of N reads
// + N writes + N×3 revalidates the old action-bar fanout produced).
// Race-free now: the underlying batchUpdateStatus / batchDeleteApplications
// helpers in lib/server/applications.ts mutate the file in a single pass.
function toBatchResult(items: Array<{ ok: boolean; num: number; error?: string }>): BatchResult {
  const errors = items
    .filter(r => !r.ok)
    .map(r => ({ num: r.num, error: r.error ?? 'unknown error' }));
  return { ok: items.length - errors.length, failed: errors.length, errors };
}

export async function batchUpdateApplicationStatusAction(
  input: BatchUpdateStatusInput,
): Promise<BatchResult> {
  const status = statusSchema.parse(input.status);
  const nums = z.array(numSchema).parse(input.nums);
  const results = batchUpdateStatus(
    ROOT,
    nums.map(num => ({ num, status })),
  );
  if (results.length > 0) revalidateApplicationSurfaces();
  return toBatchResult(results);
}

export async function batchDeleteApplicationsAction(input: {
  nums: number[];
}): Promise<BatchResult> {
  const nums = z.array(numSchema).parse(input.nums);
  const results = batchDeleteApplications(ROOT, nums);
  if (results.length > 0) revalidateApplicationSurfaces();
  return toBatchResult(results);
}

const EDITABLE_REPORT_FIELDS = [
  'archetype',
  'seniority',
  'work_mode',
  'location',
  'comp',
  'legitimacy',
];

export interface UpdateReportFieldInput {
  num: number;
  field: string;
  value: string;
}

export async function updateReportFieldAction(input: UpdateReportFieldInput): Promise<void> {
  const num = numSchema.parse(input.num);
  if (!EDITABLE_REPORT_FIELDS.includes(input.field)) {
    throw new Error(`field not editable: ${input.field}`);
  }
  const path = reportPathForNum(ROOT, num);
  if (!path) throw new Error(`no report for num: ${num}`);
  updateReportFrontmatterField(path, input.field, String(input.value));
  revalidateApplicationSurfaces();
}
