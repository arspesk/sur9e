import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeNextFollowupDate,
  computeUrgency,
  loadFollowupState,
  parseFollowupsTable,
} from '@/lib/server/followups';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const TRACKER_HEADER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|`;

function makeRoot(
  trackerRows: string[],
  followupsContent?: string,
  statusLogLines?: string[],
): string {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-followups-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(
    join(root, 'data/applications.md'),
    `${TRACKER_HEADER}\n${trackerRows.join('\n')}\n`,
  );
  if (followupsContent !== undefined) {
    writeFileSync(join(root, 'data/follow-ups.md'), followupsContent);
  }
  if (statusLogLines !== undefined) {
    writeFileSync(join(root, 'data/status-log.jsonl'), `${statusLogLines.join('\n')}\n`);
  }
  return root;
}

/** A status-log line recording `num` reaching `to` `days` ago. */
function transition(num: number, to: string, days: number, source = 'app'): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - days);
  return JSON.stringify({ num, from: null, to, at: at.toISOString(), source });
}

describe('computeUrgency', () => {
  it('applied with 0 follow-ups goes overdue at 7 days', () => {
    expect(computeUrgency('applied', 7, null, 0)).toBe('overdue');
    expect(computeUrgency('applied', 6, null, 0)).toBe('waiting');
  });
  it('applied goes cold at max follow-ups', () => {
    expect(computeUrgency('applied', 30, 1, 2)).toBe('cold');
  });
  it('responded is urgent on day 0 and overdue at 3 days', () => {
    expect(computeUrgency('responded', 0, null, 0)).toBe('urgent');
    expect(computeUrgency('responded', 3, null, 0)).toBe('overdue');
  });
  it('responded measures from last follow-up once one is logged', () => {
    expect(computeUrgency('responded', 30, 1, 1)).toBe('waiting');
    expect(computeUrgency('responded', 30, 3, 1)).toBe('overdue');
  });
  it('interview thank-you is overdue after 1 day', () => {
    expect(computeUrgency('interview', 1, null, 0)).toBe('overdue');
    expect(computeUrgency('interview', 0, null, 0)).toBe('waiting');
  });
});

describe('computeNextFollowupDate', () => {
  it('applied first follow-up is appDate + 7', () => {
    expect(computeNextFollowupDate('applied', '2026-07-01', null, 0)).toBe('2026-07-08');
  });
  it('applied subsequent is lastFollowup + 7; cold returns null', () => {
    expect(computeNextFollowupDate('applied', '2026-07-01', '2026-07-10', 1)).toBe('2026-07-17');
    expect(computeNextFollowupDate('applied', '2026-07-01', '2026-07-10', 2)).toBeNull();
  });
});

describe('parseFollowupsTable', () => {
  it('parses pipe rows and skips the header', () => {
    const rows = parseFollowupsTable(`# Follow-ups

| # | appNum | date | company | role | channel | contact | notes |
|---|---|---|---|---|---|---|---|
| 1 | 62 | 2026-07-20 | ZipRecruiter | Sales Engineer | email | jo@zr.com | pinged |
`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ num: 1, appNum: 62, date: '2026-07-20', channel: 'email' });
  });
  it('returns [] for empty/missing content', () => {
    expect(parseFollowupsTable('')).toEqual([]);
  });
});

describe('loadFollowupState', () => {
  it('counts cadence from the logged apply date, not the tracker date', () => {
    // Both rows were EVALUATED 40 days ago; they were APPLIED to at very
    // different times. Cadence must follow the apply date.
    const root = makeRoot(
      [
        `| 1 | ${isoDaysAgo(40)} | ZipRecruiter | Sales Engineer | 4.1/5 | Applied | ✅ | [1](../artifacts/reports/x.md) | - |`,
        `| 2 | ${isoDaysAgo(40)} | Massive | TAM | 3.9/5 | Applied | ✅ | - | - |`,
        `| 3 | ${isoDaysAgo(40)} | LangChain | GTM | 3.9/5 | Screened | ❌ | - | - |`,
      ],
      undefined,
      [transition(1, 'applied', 9), transition(2, 'applied', 2)],
    );
    const state = loadFollowupState(root);
    expect(state.actionable).toBe(2); // Screened row excluded
    expect(state.overdue).toBe(1);
    expect(state.entries[0].company).toBe('ZipRecruiter'); // overdue sorts first
    expect(state.entries[0].urgency).toBe('overdue');
    expect(state.entries[0].daysSinceApplication).toBe(9);
    expect(state.entries[0].appliedDate).toBe(isoDaysAgo(9));
    // Applied 2 days ago — not due until day 7, despite a 40-day-old row.
    expect(state.entries[1].urgency).toBe('waiting');
    expect(state.entries[1].daysSinceApplication).toBe(2);
  });

  it('excludes Interview-stage and later rows from follow-up counts and lists', () => {
    // Once an offer reaches Interview (or Offer/Rejected/etc.) it's past the
    // point where a follow-up push is meaningful — it must not appear in the
    // "follow-up due" counts or the FOLLOW-UPS DUE list (#69).
    const root = makeRoot(
      [
        `| 1 | ${isoDaysAgo(40)} | ZipRecruiter | Sales Engineer | 4.1/5 | Applied | ✅ | - | - |`,
        `| 2 | ${isoDaysAgo(40)} | Customer.io | Technical Operations Manager | 4.0/5 | Interview | ✅ | - | - |`,
        `| 3 | ${isoDaysAgo(40)} | Acme | SE | 3.9/5 | Offer | ✅ | - | - |`,
      ],
      undefined,
      [transition(1, 'applied', 9), transition(2, 'interview', 3), transition(3, 'offer', 1)],
    );
    const state = loadFollowupState(root);
    expect(state.actionable).toBe(1); // only the Applied row
    expect(state.entries.map(e => e.company)).toEqual(['ZipRecruiter']);
    expect(state.entries.some(e => e.status === 'interview')).toBe(false);
  });

  it('leaves a row waiting when nothing recorded when it was applied', () => {
    const root = makeRoot([
      `| 1 | ${isoDaysAgo(40)} | ZipRecruiter | Sales Engineer | 4.1/5 | Applied | ✅ | - | - |`,
    ]);
    const state = loadFollowupState(root);
    expect(state.entries[0].appliedDate).toBeNull();
    expect(state.entries[0].daysSinceApplication).toBeNull();
    expect(state.entries[0].urgency).toBe('waiting');
    expect(state.entries[0].nextFollowupDate).toBeNull();
    expect(state.overdue).toBe(0);
  });

  it('prefers an app-sourced transition over a reconciled one, last write wins', () => {
    const root = makeRoot(
      [`| 1 | ${isoDaysAgo(40)} | ZipRecruiter | SE | 4.1/5 | Applied | ✅ | - | - |`],
      undefined,
      [
        transition(1, 'applied', 30, 'reconciled'),
        transition(1, 'applied', 20),
        transition(1, 'applied', 8),
      ],
    );
    expect(loadFollowupState(root).entries[0].appliedDate).toBe(isoDaysAgo(8));
  });

  it('falls back to a reconciled transition when no app-sourced one exists', () => {
    const root = makeRoot(
      [`| 1 | ${isoDaysAgo(40)} | ZipRecruiter | SE | 4.1/5 | Applied | ✅ | - | - |`],
      undefined,
      [transition(1, 'applied', 12, 'reconciled')],
    );
    expect(loadFollowupState(root).entries[0].appliedDate).toBe(isoDaysAgo(12));
  });
  it('counts logged follow-ups per app and measures from the last one', () => {
    const root = makeRoot(
      [`| 1 | ${isoDaysAgo(30)} | ZipRecruiter | SE | 4.1/5 | Applied | ✅ | - | - |`],
      `| # | appNum | date | company | role | channel | contact | notes |
|---|---|---|---|---|---|---|---|
| 1 | 1 | ${isoDaysAgo(2)} | ZipRecruiter | SE | email | - | first nudge |
`,
      [transition(1, 'applied', 30)],
    );
    const state = loadFollowupState(root);
    expect(state.entries[0].followupCount).toBe(1);
    expect(state.entries[0].daysSinceLastFollowup).toBe(2);
    expect(state.entries[0].urgency).toBe('waiting'); // 2 < applied_subsequent(7)
  });
});
