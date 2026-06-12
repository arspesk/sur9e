// src/lib/server/__tests__/reports-frontmatter.test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter, saveReport, serializeFrontmatter } from '../reports';

describe('frontmatter format', () => {
  it('parses --- fenced YAML and returns body', () => {
    const md = `---\nnum: 16\ncompany: "Otter"\nrole: "SE"\ndate: "2026-05-24"\nstatus: "evaluated"\nstate: "evaluated"\nscore: 4.2\n---\n\n# Body header\n\nProse here.\n`;
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter.num).toBe(16);
    expect(frontmatter.company).toBe('Otter');
    expect(body.startsWith('# Body header')).toBe(true);
  });

  it('round-trips through parse → serialize', () => {
    const md = `---\nnum: 1\ncompany: "X"\nrole: "Y"\ndate: "2026-05-25"\nstatus: "screened"\nstate: "screened"\nscore: 3\n---\n\nbody\n`;
    const { frontmatter, body } = parseFrontmatter(md);
    const out = serializeFrontmatter(frontmatter, body);
    const reparsed = parseFrontmatter(out);
    expect(reparsed.frontmatter).toEqual(frontmatter);
    expect(reparsed.body.trim()).toBe('body');
  });

  it("accepts the screener's 'N/A' score sentinel and round-trips it", () => {
    // batch/screen.mjs writes score: N/A for unreadable/prefiltered postings
    // (never a fabricated 0.0) — these reports must stay loadable.
    const md = `---\nnum: 150\ncompany: "RGH-Global"\nrole: "People Services"\ndate: "2026-06-05"\nstatus: "Discarded"\nstate: "screened"\nscore: N/A\n---\n\nbody\n`;
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter.score).toBe('N/A');
    expect(body.trim()).toBe('body');
    const reparsed = parseFrontmatter(serializeFrontmatter(frontmatter, body));
    expect(reparsed.frontmatter.score).toBe('N/A');
  });

  it('detects legacy format (no leading ---)', () => {
    const legacy = `# Evaluation: X — Y\n\n**Date:** 2026-05-25\n`;
    expect(() => parseFrontmatter(legacy)).toThrow(/not frontmatter/i);
  });

  it('saveReport writes atomically with .bak preservation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sur9e-rpt-'));
    const file = join(dir, '001-test-2026-05-25.md');
    writeFileSync(file, 'original\n', 'utf8');
    saveReport({
      filePath: file,
      frontmatter: {
        num: 1,
        company: 'X',
        role: 'Y',
        date: '2026-05-25',
        status: 'screened',
        state: 'screened',
        score: 3,
      },
      body: 'new body\n',
    });
    const after = readFileSync(file, 'utf8');
    expect(after.startsWith('---\n')).toBe(true);
    expect(after).toContain('new body');
    const bak = readFileSync(`${file}.bak`, 'utf8');
    expect(bak).toBe('original\n');
    rmSync(dir, { recursive: true });
  });

  it('loadReport returns format: "frontmatter" for new-format files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sur9e-rpt2-'));
    // loadReport(rootPath, filename) looks under rootPath/artifacts/reports/.
    mkdirSync(join(dir, 'artifacts', 'reports'), { recursive: true });
    const file = join(dir, 'artifacts', 'reports', '001-x-2026-05-25.md');
    writeFileSync(
      file,
      `---\nnum: 1\ncompany: "X"\nrole: "Y"\ndate: "2026-05-25"\nstatus: "screened"\nstate: "screened"\nscore: 3\n---\n\nhello\n`,
      'utf8',
    );
    const mod = await import('../reports');
    const r = mod.loadReport(dir, '001-x-2026-05-25.md');
    expect(r).not.toBeNull();
    expect((r as any).format).toBe('frontmatter');
    expect((r as any).body).toContain('hello');
    rmSync(dir, { recursive: true });
  });

  it('keeps the optional posted field and projects it into the summary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sur9e-rpt3-'));
    mkdirSync(join(dir, 'artifacts', 'reports'), { recursive: true });
    writeFileSync(
      join(dir, 'artifacts', 'reports', '002-x-2026-06-10.md'),
      `---\nnum: 2\ncompany: "X"\nrole: "Y"\ndate: "2026-06-10"\nposted: "2026-06-01"\nstatus: "screened"\nstate: "screened"\nscore: 3\n---\n\nhello\n`,
      'utf8',
    );
    const mod = await import('../reports');
    const r = mod.loadReport(dir, '002-x-2026-06-10.md') as any;
    expect(r.posted).toBe('2026-06-01');
    expect(r.date).toBe('2026-06-10'); // added/scan date untouched
    expect(r.summary.posted).toBe('2026-06-01');
    rmSync(dir, { recursive: true });
  });

  it('coerces a hand-edited unquoted posted date (js-yaml Date object) back to YYYY-MM-DD', () => {
    const md = `---\nnum: 3\ncompany: "X"\nrole: "Y"\ndate: "2026-06-10"\nposted: 2026-06-01\nstatus: "screened"\nstate: "screened"\nscore: 3\n---\n\nbody\n`;
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.posted).toBe('2026-06-01');
  });

  it('reports without posted parse exactly as before (field absent, not empty)', () => {
    const md = `---\nnum: 4\ncompany: "X"\nrole: "Y"\ndate: "2026-06-10"\nstatus: "screened"\nstate: "screened"\nscore: 3\n---\n\nbody\n`;
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.posted).toBeUndefined();
  });
});
