import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { updateReportFrontmatterField } from '../reports';

const FIXTURE = `---
num: 16
company: Otter
role: Solutions Engineer
date: '2026-05-24'
status: applied
state: evaluated
score: 4.1
seniority: Mid-Senior level
---

## Role summary

Body stays intact.
`;

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sur9e-rep-'));
  const path = join(dir, '016-otter-2026-05-24.md');
  writeFileSync(path, FIXTURE, 'utf8');
  return path;
}

describe('updateReportFrontmatterField', () => {
  it('rewrites a single key and preserves the body', () => {
    const path = writeFixture();
    updateReportFrontmatterField(path, 'work_mode', 'On-site');
    const out = readFileSync(path, 'utf8');
    expect(out).toMatch(/work_mode: On-site/);
    expect(out).toContain('Body stays intact.');
    expect(out).toContain('## Role summary');
  });

  it('preserves existing keys when adding a new one', () => {
    const path = writeFixture();
    updateReportFrontmatterField(path, 'work_mode', 'On-site');
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('company: Otter');
    expect(out).toContain('seniority: Mid-Senior level');
  });

  it('rejects an out-of-enum seniority', () => {
    const path = writeFixture();
    expect(() => updateReportFrontmatterField(path, 'seniority', 'Wizard')).toThrow();
  });

  it('rejects an unknown / read-only field', () => {
    const path = writeFixture();
    expect(() => updateReportFrontmatterField(path, 'score', '5')).toThrow();
  });
});
