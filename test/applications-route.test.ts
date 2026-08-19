// @vitest-environment node
//
// test/applications-route.test.ts
//
// GET /api/applications back-compat contract (issues #104/#107): with no
// recognized query params the response stays byte-identical to the legacy
// `{ entries, count }` payload with full summaries (the web UI's TanStack
// hook consumes it); any recognized filter param — or fields=compact —
// switches to the paginated compact shape from queryApplications. Pattern B
// (see turns-route.test.ts): tmpdir + SUR9E_ROOT + vi.resetModules() +
// dynamic import so the route's module-level ROOT binding points at this
// test's throwaway root, never the repo.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ApplicationsRoute = typeof import('@/app/api/applications/route');
type ApplicationsLib = typeof import('@/lib/server/applications');

let root: string;
let route: ApplicationsRoute;
let applications: ApplicationsLib;

async function loadRoot(): Promise<void> {
  root = mkdtempSync(join(tmpdir(), 'sur9e-apps-route-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
  writeFileSync(
    join(root, 'data/applications.md'),
    `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-07-01 | Acme | Platform Engineer | 4.2/5 | Evaluated | ✅ | [1](artifacts/reports/001-acme.md) | - |  |
| 2 | 2026-07-05 | Globex | Sales Engineer | 3.1/5 | Applied | ✅ | - | - |  |
`,
  );
  writeFileSync(
    join(root, 'artifacts/reports/001-acme.md'),
    [
      '---',
      'num: 1',
      'company: Acme',
      'role: Platform Engineer',
      "date: '2026-07-01'",
      'state: evaluated',
      'score: 4.2',
      'url: https://jobs.acme.dev/platform',
      'location: Barcelona, Spain',
      'work_mode: Hybrid',
      '---',
      '',
      '# Report body',
      '',
    ].join('\n'),
  );
  process.env.SUR9E_ROOT = root;
  vi.resetModules();
  route = await import('@/app/api/applications/route');
  applications = await import('@/lib/server/applications');
}

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.SUR9E_ROOT;
});

function get(query = ''): Response {
  return route.GET(new Request(`http://localhost/api/applications${query}`));
}

describe('GET /api/applications — legacy back-compat', () => {
  it('stays byte-identical to the full-summary payload with no params', async () => {
    await loadRoot();
    const res = get();
    expect(res.status).toBe(200);
    const entries = applications.loadApplicationsWithSummary(root);
    expect(await res.text()).toBe(JSON.stringify({ entries, count: entries.length }));
  });

  it('keeps the legacy shape when only unrecognized params are present', async () => {
    await loadRoot();
    const res = get('?foo=bar&baz=1');
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.total).toBeUndefined();
    expect(body.next_offset).toBeUndefined();
    expect(body.entries[0]).toHaveProperty('summary');
  });
});

describe('GET /api/applications — filtered compact shape', () => {
  it('a filter param switches to the paginated compact payload', async () => {
    await loadRoot();
    const res = get('?status=applied');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 1, count: 1, next_offset: null });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ num: 2, company: 'Globex', status: 'applied' });
    expect(body.entries[0]).not.toHaveProperty('summary');
  });

  it('fields=compact alone switches shape without filtering', async () => {
    await loadRoot();
    const body = await get('?fields=compact').json();
    expect(body.total).toBe(2);
    expect(body.count).toBe(2);
    expect(body.entries.map((e: { num: number }) => e.num)).toEqual([1, 2]);
    expect(body.entries[0].url).toBe('https://jobs.acme.dev/platform');
  });

  it('maps snake_case params onto the lib filters', async () => {
    await loadRoot();
    const body = await get('?work_mode=hybrid&min_score=4&role=engineer').json();
    expect(body.entries.map((e: { num: number }) => e.num)).toEqual([1]);
    const paged = await get('?fields=compact&limit=1&offset=1').json();
    expect(paged.entries.map((e: { num: number }) => e.num)).toEqual([2]);
    expect(paged.next_offset).toBeNull();
    expect(paged.total).toBe(2);
  });

  it('rejects invalid param values with a 400', async () => {
    await loadRoot();
    for (const query of [
      '?min_score=abc',
      '?status=bogus',
      '?since=07-01-2026',
      '?limit=two',
      '?fields=full',
    ]) {
      const res = get(query);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
  });
});
