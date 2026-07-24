import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logFollowup, parseFollowupsTable } from '@/lib/server/followups';

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 62 | 2026-07-10 | ZipRecruiter | Sales Engineer | 4.1/5 | Applied | ✅ | - | - |
`;

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-fulog-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), TRACKER);
  return root;
}

describe('logFollowup', () => {
  it('creates follow-ups.md with header on first log', () => {
    const root = makeRoot();
    const row = logFollowup(root, { appNum: 62, channel: 'email', notes: 'nudged recruiter' });
    expect(row).toMatchObject({ num: 1, appNum: 62, channel: 'email' });
    const content = readFileSync(join(root, 'data/follow-ups.md'), 'utf-8');
    expect(content).toContain('# Follow-ups');
    expect(content).toContain('| appNum |');
    expect(parseFollowupsTable(content)).toHaveLength(1);
    expect(parseFollowupsTable(content)[0].notes).toBe('nudged recruiter');
  });
  it('appends with an incrementing num and strips pipes from notes', () => {
    const root = makeRoot();
    logFollowup(root, { appNum: 62 });
    const second = logFollowup(root, { appNum: 62, notes: 'a|b' });
    expect(second.num).toBe(2);
    const rows = parseFollowupsTable(readFileSync(join(root, 'data/follow-ups.md'), 'utf-8'));
    expect(rows).toHaveLength(2);
    expect(rows[1].notes).toBe('a/b');
  });
  it('throws for an unknown appNum and creates nothing', () => {
    const root = makeRoot();
    expect(() => logFollowup(root, { appNum: 999 })).toThrow(/999/);
    expect(existsSync(join(root, 'data/follow-ups.md'))).toBe(false);
  });
});
