// lib/server/status-log.ts
//
// Append-only status-transition log: data/status-log.jsonl.
//
// Three operations:
//   appendTransition  — one line per status change (called by updateStatus)
//   loadStatusLog     — parse the JSONL, dropping malformed lines
//   reconcileStatusLog — heal drift: statuses changed outside the app
//                        (hand-edits to applications.md, merge-tracker,
//                        normalize-statuses) get synthetic 'reconciled'
//                        transitions so the log eventually agrees with the
//                        tracker. Called by the analytics loader before
//                        computing history-aware metrics.
//
// The log is derived bookkeeping, not user data: deleting it loses history
// but the next reconcile pass rebuilds a baseline from current statuses.

import 'server-only';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ApplicationStatus } from '../schemas/applications';
import { StatusTransition } from '../schemas/status-log';
import { readFileOrNull } from './read-or-null';

const LOG_REL_PATH = 'data/status-log.jsonl';

function logPath(rootPath: string): string {
  return join(rootPath, LOG_REL_PATH);
}

/** Append one transition. Throws on schema violation (caller bug). */
export function appendTransition(rootPath: string, entry: StatusTransition): void {
  const validated = StatusTransition.parse(entry);
  appendFileSync(logPath(rootPath), `${JSON.stringify(validated)}\n`, 'utf-8');
}

/**
 * Load and parse the full log, oldest-first. Malformed lines are skipped
 * (a partial line from an interrupted write must not poison the rest).
 * Missing file → empty log.
 */
export function loadStatusLog(rootPath: string): StatusTransition[] {
  const raw = readFileOrNull(logPath(rootPath));
  if (raw == null) return [];
  const out: StatusTransition[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(StatusTransition.parse(JSON.parse(trimmed)));
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/** Latest known status per num, derived from the log (last write wins). */
export function lastLoggedStatus(log: StatusTransition[]): Map<number, ApplicationStatus> {
  const m = new Map<number, ApplicationStatus>();
  for (const t of log) m.set(t.num, t.to);
  return m;
}

export interface ReconcileEntry {
  num: number;
  status: ApplicationStatus;
}

/**
 * Compare the tracker's current statuses against the log tail and append a
 * synthetic 'reconciled' transition for every drifted or never-seen offer.
 * Returns the transitions that were appended (empty array = log was in sync).
 *
 * `from` on a reconciled transition is the last LOGGED status (or null when
 * the offer was never logged) — honest about what is actually known: the
 * tracker cell is mutable, so any intermediate hops are lost.
 */
export function reconcileStatusLog(
  rootPath: string,
  current: ReconcileEntry[],
  now: () => string = () => new Date().toISOString(),
): StatusTransition[] {
  const log = loadStatusLog(rootPath);
  const tail = lastLoggedStatus(log);
  const appended: StatusTransition[] = [];
  for (const { num, status } of current) {
    const logged = tail.get(num) ?? null;
    if (logged === status) continue;
    const entry: StatusTransition = {
      num,
      from: logged,
      to: status,
      at: now(),
      source: 'reconciled',
    };
    appendTransition(rootPath, entry);
    appended.push(entry);
  }
  return appended;
}

/** True when the log file exists on disk (used by tests/doctor). */
export function statusLogExists(rootPath: string): boolean {
  return existsSync(logPath(rootPath));
}
