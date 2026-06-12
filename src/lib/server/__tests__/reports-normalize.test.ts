// src/lib/server/__tests__/reports-normalize.test.ts
//
// The report-markdown normalizer is wired into the two reports.ts write/read
// chokepoints. saveReport normalizes on persist (also covering the PATCH
// route, which funnels through saveReport on its whole-body write) and
// loadReport heals on display.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadReport, parseFrontmatter, saveReport } from '../reports';

const DIRTY_BODY = [
  '\\## TL;DR',
  '',
  'Strong SE fit with touchpoints \\~60% aligned to the stack.',
  '',
  '> ✅ Strongest match: hands-on platform work maps direct.',
  '',
  '**PDF:** [Download the tailored CV](/artifacts/cv/example.pdf)',
  '',
].join('\n');

const FM = {
  num: 1,
  company: 'X',
  role: 'Y',
  date: '2026-06-01',
  status: 'evaluated',
  state: 'evaluated',
  score: 4.2,
} as const;

describe('reports normalize on persist (saveReport)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sur9e-norm-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saveReport normalizes the body before writing', () => {
    const file = join(dir, '001-x-2026-06-01.md');
    saveReport({ filePath: file, frontmatter: { ...FM }, body: DIRTY_BODY });
    const written = readFileSync(file, 'utf8');
    const { body } = parseFrontmatter(written);
    // unescape ran
    expect(body).not.toMatch(/\\#/);
    expect(body).toContain('~60%');
    // blockquote-callout converted
    expect(body).toContain('<div data-callout data-variant="success"');
    expect(body).not.toMatch(/^>\s*✅/m);
    // pdf-line dropped
    expect(body).not.toContain('**PDF:**');
  });
});

describe('reports heal on display (loadReport)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-load-'));
    mkdirSync(join(root, 'artifacts', 'reports'), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('loadReport returns a normalized body for an already-corrupted file', () => {
    // Write a dirty report straight to disk WITHOUT saveReport so the heal is
    // proven to happen on read, not on the write.
    const dirty = `---\nnum: 3\ncompany: "X"\nrole: "Y"\ndate: "2026-06-01"\nstatus: "evaluated"\nstate: "evaluated"\nscore: 4.2\n---\n\n${DIRTY_BODY}`;
    const file = join(root, 'artifacts', 'reports', '003-x-2026-06-01.md');
    writeFileSync(file, dirty, 'utf8');

    const result = loadReport(root, '003-x-2026-06-01.md', 'evaluated') as unknown as {
      body: string;
      format: string;
    };
    expect(result.format).toBe('frontmatter');
    expect(result.body).not.toMatch(/\\#/);
    expect(result.body).toContain('<div data-callout data-variant="success"');
    expect(result.body).not.toContain('**PDF:**');

    // Display only: the file on disk is untouched.
    expect(readFileSync(file, 'utf8')).toBe(dirty);
  });
});
