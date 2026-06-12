import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadReport } from '@/lib/server/reports';

// Regression: loadReportImpl previously guarded only against path separators /
// dot-dot, with no extension whitelist. Any flat filename under
// artifacts/reports/ was served -- including editor/migration backups
// (*.md.bak), which are near-identical siblings of real reports. The loader now
// mirrors the `.md` filter used by the listing functions (findByNum, search).
describe('loadReport extension whitelist', () => {
  let root: string;
  const mdName = '005-acme-2026-06-05.md';
  const bakName = '005-acme-2026-06-05.md.bak';
  const report =
    '---\nnum: 5\ncompany: Acme\nrole: Engineer\ndate: "2026-06-05"\nscore: 4\n---\n\n## TL;DR: hi\n\nbody\n';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-reports-'));
    const dir = join(root, 'artifacts', 'reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, mdName), report);
    writeFileSync(join(dir, bakName), report);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('serves a canonical .md report', () => {
    const res = loadReport(root, mdName);
    expect('error' in res).toBe(false);
  });

  it('rejects a .bak backup sibling', () => {
    const res = loadReport(root, bakName);
    expect(res).toMatchObject({ error: 'Invalid filename', path: null });
  });

  it('rejects a non-.md extension even with the artifacts/reports/ prefix', () => {
    const res = loadReport(root, `artifacts/reports/${bakName}`);
    expect(res).toMatchObject({ error: 'Invalid filename', path: null });
  });
});
