// src/lib/server/__tests__/reports-schema.test.ts
//
// Parse-boundary tests for the typed loadReport entrypoint. Reports are
// frontmatter-only now — non-frontmatter (legacy) files are rejected with an
// explicit error rather than silently rendered.
// All fixtures live in os.tmpdir() — never touches the real artifacts/reports/ tree.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportData } from '../../schemas/reports';
// Resolves to ../reports.ts (the typed wrapper). See usage-schema.test.ts
// for why vitest.config.ts pins resolve.extensions to prefer .ts over .mjs.
import { loadReport } from '../reports';

const SCREENED_MD = [
  '---',
  'num: 1',
  'company: Acme',
  'role: Engineer',
  "date: '2026-05-15'",
  'url: https://acme.example.com/jobs/1',
  'status: Screened',
  'state: screened',
  'score: 4.2',
  'archetype: Forward Deployed Engineer',
  'archetype_short: FDE',
  'seniority: Mid-Senior',
  'seniority_short: Mid-Senior',
  'remote: Remote (US)',
  'loc_short: Remote (US)',
  'comp: $150K–$180K',
  'comp_short: $150K–$180K',
  'legitimacy: high_confidence',
  'tldr: Strong title match.',
  '---',
  '',
  '## TL;DR',
  '',
  'Strong title match.',
  '',
].join('\n');

const EVALUATED_MD = [
  '---',
  'num: 2',
  'company: Globex',
  'role: Senior Engineer',
  "date: '2026-05-14'",
  'url: https://globex.example.com/careers/42',
  'status: Evaluated',
  'state: evaluated',
  'score: 3.8',
  'archetype: Backend Engineer',
  'archetype_short: Backend',
  'legitimacy: likely_legitimate',
  'tldr: Solid backend role.',
  '---',
  '',
  '## TL;DR',
  '',
  'Solid backend role.',
  '',
].join('\n');

// Backfill path: frontmatter that omits `state` — the loader heals it from
// `status` rather than rejecting the file.
const NO_STATE_MD = [
  '---',
  'num: 3',
  'company: Initech',
  'role: Engineer',
  "date: '2026-05-13'",
  'status: Evaluated',
  'score: 4.0',
  'archetype: Platform Engineer',
  'tldr: Healed state.',
  '---',
  '',
  '## TL;DR',
  '',
  'Healed state.',
  '',
].join('\n');

// Legacy structured-report format (no leading `---` frontmatter block). This
// format is no longer supported — loadReport must reject it with an error.
const LEGACY_MD = [
  '# Evaluation: Acme — Engineer',
  '',
  '**Date:** 2026-05-15',
  '**Score:** 4.2/5',
  '',
  '## Role Fit',
  '',
  '```yaml',
  'archetype: "Forward Deployed Engineer"',
  '```',
  '',
].join('\n');

function makeTmpRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'reports-schema-test-'));
  mkdirSync(join(root, 'artifacts', 'reports'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, 'artifacts', 'reports', name), content);
  }
  return root;
}

describe('reports.ts — schema boundary', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('loadReport parses a screened frontmatter fixture', () => {
    root = makeTmpRoot({ 'screened.md': SCREENED_MD });
    const result = loadReport(root, 'screened.md', 'screened');
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.fileName).toBe('screened.md');
    expect((result as { format?: string }).format).toBe('frontmatter');
    expect(result.markdown).toContain('Acme');
    expect(result.html).toContain('<h2');
  });

  it('loadReport parses an evaluated frontmatter fixture', () => {
    root = makeTmpRoot({ 'evaluated.md': EVALUATED_MD });
    const result = loadReport(root, 'evaluated.md', 'evaluated');
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect((result as { state?: string }).state).toBe('evaluated');
    expect(result.markdown).toContain('Senior Engineer');
  });

  it('loadReport heals frontmatter missing `state` from `status`', () => {
    root = makeTmpRoot({ 'nostate.md': NO_STATE_MD });
    const result = loadReport(root, 'nostate.md', 'evaluated');
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect((result as { state?: string }).state).toBe('evaluated');
  });

  it('loadReport accepts the "artifacts/reports/" prefix on slugOrPath', () => {
    root = makeTmpRoot({ 'screened.md': SCREENED_MD });
    const result = loadReport(root, 'artifacts/reports/screened.md', 'screened');
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.fileName).toBe('screened.md');
  });

  it('loadReport returns an error envelope when the file is missing', () => {
    root = makeTmpRoot({});
    const result = loadReport(root, 'missing.md');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/not found/i);
    }
  });

  it('loadReport rejects path traversal attempts', () => {
    root = makeTmpRoot({});
    const result = loadReport(root, '../../etc/passwd');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/invalid/i);
    }
  });

  it('loadReport rejects a legacy (non-frontmatter) report with an explicit error', () => {
    root = makeTmpRoot({ 'legacy.md': LEGACY_MD });
    const result = loadReport(root, 'legacy.md', 'screened');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/legacy/i);
    }
  });

  it('loadReport schema (ReportData) tolerates parsed: null', () => {
    // ParsedReport is nullable inside ReportData — explicit shape check so a
    // future runtime change that returns null here still validates.
    const result = ReportData.safeParse({
      markdown: '# any',
      html: '<h1>any</h1>',
      fileName: 'any.md',
      parsed: null,
    });
    expect(result.success).toBe(true);
  });
});
