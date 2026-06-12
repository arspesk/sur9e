// lib/schemas/status-log.ts
//
// zod schema for data/status-log.jsonl — the append-only status-transition
// log. One JSON object per line; each line records a single offer moving
// from one pipeline status to another at a point in time.
//
// Why a log and not just the tracker cell: data/applications.md stores only
// the CURRENT status, so the moment an offer flips to `rejected` the system
// forgets where it was rejected from (applied? interview?). The log keeps
// the full path, which is what stage-of-rejection and time-in-stage
// analytics need, and lets the funnel cumulate on max-stage-ever-reached
// instead of bleeding counts when a deep-stage offer is rejected.

import { z } from 'zod';
import { ApplicationStatus } from './applications';

export const TRANSITION_SOURCES = [
  // Recorded at mutation time by updateStatus() (app UI / server action / API).
  'app',
  // Synthesized by the reconcile pass when the tracker's current status
  // disagrees with the log tail — covers hand-edits to applications.md and
  // CLI tools (merge-tracker, normalize-statuses) that bypass updateStatus.
  // Reconciled timestamps are observation time, not transition time.
  'reconciled',
] as const;

export const StatusTransition = z.object({
  num: z.number().int().positive(),
  // null = first observation of this offer (no prior status known).
  from: ApplicationStatus.nullable(),
  to: ApplicationStatus,
  // ISO-8601 timestamp. For source='app' this is the transition moment;
  // for source='reconciled' it is when the drift was noticed (upper bound).
  at: z.string(),
  source: z.enum(TRANSITION_SOURCES),
});
export type StatusTransition = z.infer<typeof StatusTransition>;
