// src/lib/server/followups.ts
//
// Server port of cli/followup-cadence.mjs (pure cadence math + file reads).
// KEEP CADENCE VALUES IN SYNC with the CLI — the CLI stays the offline tool,
// this module powers the Home tab. Both read the same two files:
// data/applications.md (tracker) and data/follow-ups.md (sent follow-ups).

import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadApplications, loadApplicationsWithSummary, normalizeStatus } from './applications';
import { atomicWrite } from './atomic-write';
import { loadStatusLog } from './status-log';

export const CADENCE = {
  applied_first: 7,
  applied_subsequent: 7,
  applied_max_followups: 2,
  responded_initial: 1,
  responded_subsequent: 3,
  interview_thankyou: 1,
} as const;

const ACTIONABLE_STATUSES = new Set(['applied', 'responded', 'interview']);

export type Urgency = 'urgent' | 'overdue' | 'waiting' | 'cold';

export interface FollowupLogRow {
  num: number;
  appNum: number;
  date: string;
  channel: string;
  contact: string;
  notes: string;
}

export interface FollowupEntry {
  num: number;
  date: string;
  company: string;
  role: string;
  status: string;
  score: string;
  notes: string;
  /** Date the row actually reached its current stage (applied/responded/
   * interview), from the status log — NOT the tracker's evaluation date.
   * null when nothing ever recorded the transition. */
  appliedDate: string | null;
  /** null when appliedDate is unknown — the row is shown as waiting rather
   * than inventing an age for it. */
  daysSinceApplication: number | null;
  daysSinceLastFollowup: number | null;
  followupCount: number;
  urgency: Urgency;
  nextFollowupDate: string | null;
  reportPath: string | null;
  companyLogo: string | null;
}

export interface FollowupState {
  analysisDate: string;
  actionable: number;
  overdue: number;
  urgent: number;
  waiting: number;
  cold: number;
  entries: FollowupEntry[];
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) return null;
  return new Date(dateStr.trim());
}

function daysBetween(d1: Date, d2: Date): number {
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number): string {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function todayUtc(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/** Parse data/follow-ups.md pipe-table rows (same positional contract as the
 * CLI's parseFollowups: ≥8 cells, numeric first cell — header rows drop out). */
export function parseFollowupsTable(content: string): FollowupLogRow[] {
  const rows: FollowupLogRow[] = [];
  for (const line of content.split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 8) continue;
    const num = Number.parseInt(parts[1], 10);
    if (Number.isNaN(num)) continue;
    rows.push({
      num,
      appNum: Number.parseInt(parts[2], 10),
      date: parts[3],
      channel: parts[6] ?? '',
      contact: parts[7] ?? '',
      notes: parts[8] ?? '',
    });
  }
  return rows;
}

/** When each num last reached a given status, per the status log.
 *
 * Only `source: 'app'` transitions carry a real transition time — a
 * 'reconciled' row is when a CLI/out-of-band change was *noticed*, which is an
 * upper bound, not the event. App-sourced wins; reconciled is the fallback so
 * pre-existing rows still get something better than the evaluation date.
 * Last write wins: an offer that went applied → discarded → applied restarts
 * its cadence, which is what the user means by "I applied again".
 */
export function appliedDatesFromLog(
  log: Array<{ num: number; to: string; at: string; source: string }>,
  status: string,
): Map<number, string> {
  const preferred = new Map<number, string>();
  const fallback = new Map<number, string>();
  for (const t of log) {
    if (t.to !== status) continue;
    const day = t.at.slice(0, 10);
    if (t.source === 'app') preferred.set(t.num, day);
    else fallback.set(t.num, day);
  }
  for (const [num, day] of fallback) {
    if (!preferred.has(num)) preferred.set(num, day);
  }
  return preferred;
}

/** Verbatim port of the CLI's computeUrgency. */
export function computeUrgency(
  status: string,
  daysSinceApp: number,
  daysSinceLastFollowup: number | null,
  followupCount: number,
): Urgency {
  if (status === 'applied') {
    if (followupCount >= CADENCE.applied_max_followups) return 'cold';
    if (followupCount === 0 && daysSinceApp >= CADENCE.applied_first) return 'overdue';
    if (
      followupCount > 0 &&
      daysSinceLastFollowup !== null &&
      daysSinceLastFollowup >= CADENCE.applied_subsequent
    )
      return 'overdue';
    return 'waiting';
  }
  if (status === 'responded') {
    // Once a follow-up is logged, measure from it — not from the tracker date,
    // which never moves and would flag the row overdue forever.
    if (followupCount > 0) {
      if (daysSinceLastFollowup !== null && daysSinceLastFollowup >= CADENCE.responded_subsequent)
        return 'overdue';
      return 'waiting';
    }
    if (daysSinceApp < CADENCE.responded_initial) return 'urgent';
    if (daysSinceApp >= CADENCE.responded_subsequent) return 'overdue';
    return 'waiting';
  }
  if (status === 'interview') {
    if (followupCount > 0) {
      if (daysSinceLastFollowup !== null && daysSinceLastFollowup >= CADENCE.interview_thankyou)
        return 'overdue';
      return 'waiting';
    }
    if (daysSinceApp >= CADENCE.interview_thankyou) return 'overdue';
    return 'waiting';
  }
  return 'waiting';
}

/** Verbatim port of the CLI's computeNextFollowupDate. */
export function computeNextFollowupDate(
  status: string,
  appDate: string,
  lastFollowupDate: string | null,
  followupCount: number,
): string | null {
  const app = parseDate(appDate);
  const last = lastFollowupDate ? parseDate(lastFollowupDate) : null;
  if (status === 'applied') {
    if (followupCount >= CADENCE.applied_max_followups) return null;
    if (followupCount === 0) return app ? addDays(app, CADENCE.applied_first) : null;
    if (last) return addDays(last, CADENCE.applied_subsequent);
    return app ? addDays(app, CADENCE.applied_first) : null;
  }
  if (status === 'responded') {
    if (last) return addDays(last, CADENCE.responded_subsequent);
    return app ? addDays(app, CADENCE.responded_subsequent) : null;
  }
  if (status === 'interview') {
    if (last) return addDays(last, CADENCE.interview_thankyou);
    return app ? addDays(app, CADENCE.interview_thankyou) : null;
  }
  return null;
}

const URGENCY_ORDER: Record<Urgency, number> = { urgent: 0, overdue: 1, waiting: 2, cold: 3 };

/** Cadence state for every actionable tracker row, urgency-sorted. */
export function loadFollowupState(rootPath: string): FollowupState {
  // WithSummary (not loadApplications) so rows carry the report's company
  // logo; both share the same cached tracker read.
  const apps = loadApplicationsWithSummary(rootPath);
  const followupsPath = join(rootPath, 'data/follow-ups.md');
  const logged = existsSync(followupsPath)
    ? parseFollowupsTable(readFileSync(followupsPath, 'utf-8'))
    : [];

  const byApp = new Map<number, FollowupLogRow[]>();
  for (const row of logged) {
    const list = byApp.get(row.appNum) ?? [];
    list.push(row);
    byApp.set(row.appNum, list);
  }

  // Cadence counts from when the row actually reached its stage, not from the
  // tracker's evaluation date — counting from the latter reported every row as
  // weeks overdue the moment it was applied to.
  const log = loadStatusLog(rootPath);
  const stageDates = new Map<string, Map<number, string>>();
  for (const status of ACTIONABLE_STATUSES) {
    stageDates.set(status, appliedDatesFromLog(log, status));
  }

  const now = todayUtc();
  const entries: FollowupEntry[] = [];
  for (const app of apps) {
    const status = normalizeStatus(app.status);
    if (!ACTIONABLE_STATUSES.has(status)) continue;

    const stageDay = stageDates.get(status)?.get(app.num) ?? null;
    const stageDate = stageDay ? parseDate(stageDay) : null;

    const appFollowups = (byApp.get(app.num) ?? []).sort((a, b) => (a.date > b.date ? -1 : 1));
    const followupCount = appFollowups.length;
    const lastFollowupDate = appFollowups[0]?.date ?? null;
    const lastDate = lastFollowupDate ? parseDate(lastFollowupDate) : null;
    const daysSinceLastFollowup = lastDate ? daysBetween(lastDate, now) : null;
    const daysSinceApplication = stageDate ? daysBetween(stageDate, now) : null;

    entries.push({
      num: app.num,
      date: app.date,
      company: app.company,
      role: app.role,
      status,
      score: app.score,
      notes: app.notes,
      appliedDate: stageDay,
      daysSinceApplication,
      daysSinceLastFollowup,
      followupCount,
      // No recorded transition → nothing is known about how long this has been
      // waiting, so it stays 'waiting' instead of claiming an age it can't know.
      urgency:
        daysSinceApplication == null
          ? 'waiting'
          : computeUrgency(status, daysSinceApplication, daysSinceLastFollowup, followupCount),
      nextFollowupDate: stageDay
        ? computeNextFollowupDate(status, stageDay, lastFollowupDate, followupCount)
        : null,
      reportPath: app.reportPath,
      companyLogo: app.summary?.company_logo || null,
    });
  }

  entries.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);

  return {
    analysisDate: now.toISOString().slice(0, 10),
    actionable: entries.length,
    overdue: entries.filter(e => e.urgency === 'overdue').length,
    urgent: entries.filter(e => e.urgency === 'urgent').length,
    waiting: entries.filter(e => e.urgency === 'waiting').length,
    cold: entries.filter(e => e.urgency === 'cold').length,
    entries,
  };
}

const FOLLOWUPS_HEADER = `# Follow-ups

| # | appNum | date | company | role | channel | contact | notes |
|---|---|---|---|---|---|---|---|
`;

/** Sanitize a user-supplied cell so it can't break the pipe table. */
function cell(value: string | undefined, fallback = '-'): string {
  const v = (value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  return v || fallback;
}

/** Append a sent-follow-up row (the canonical format the CLI parses).
 * Creates data/follow-ups.md with its header on first use. */
export function logFollowup(
  rootPath: string,
  input: { appNum: number; channel?: string; contact?: string; notes?: string },
): FollowupLogRow {
  const app = loadApplications(rootPath).find(a => a.num === input.appNum);
  if (!app) throw new Error(`appNum not found in tracker: ${input.appNum}`);

  const path = join(rootPath, 'data/follow-ups.md');
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : FOLLOWUPS_HEADER;
  const rows = parseFollowupsTable(existing);
  const num = rows.length > 0 ? Math.max(...rows.map(r => r.num)) + 1 : 1;
  const date = new Date().toISOString().slice(0, 10);

  const row: FollowupLogRow = {
    num,
    appNum: input.appNum,
    date,
    channel: cell(input.channel, 'app'),
    contact: cell(input.contact),
    notes: cell(input.notes),
  };
  const line = `| ${row.num} | ${row.appNum} | ${row.date} | ${cell(app.company)} | ${cell(app.role)} | ${row.channel} | ${row.contact} | ${row.notes} |`;
  const base = existing.endsWith('\n') ? existing : `${existing}\n`;
  atomicWrite(path, `${base}${line}\n`);
  return row;
}
