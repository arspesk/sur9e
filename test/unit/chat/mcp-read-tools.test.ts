// test/unit/chat/mcp-read-tools.test.ts
//
// The five read tools are thin HTTP clients over the app's JSON API.
// A node:http mock app on an ephemeral port stands in for the real
// server; assertions check both the relayed data and what was requested.

import { afterEach, describe, expect, it } from 'vitest';
import { McpTestClient, type MockApp, startMockApp } from './mcp-test-utils';

describe('mcp-app-server — read tools', () => {
  let client: McpTestClient;
  let app: MockApp | undefined;

  afterEach(async () => {
    client?.kill();
    await app?.close();
    app = undefined;
  });

  async function callTool(name: string, args: Record<string, unknown> = {}) {
    client = new McpTestClient({ SUR9E_APP_URL: app?.url ?? 'http://127.0.0.1:9' });
    await client.initialize();
    return client.request(2, 'tools/call', { name, arguments: args });
  }

  it('tools/list advertises the five read tools', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: 'http://127.0.0.1:9' });
    await client.initialize();
    const res = await client.request(2, 'tools/list');
    const names = res.result.tools.map((t: { name: string }) => t.name);
    for (const name of [
      'get_tracker',
      'get_report',
      'get_pipeline',
      'get_profile_summary',
      'list_jobs',
    ]) {
      expect(names).toContain(name);
    }
    for (const tool of res.result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('get_tracker relays the applications payload', async () => {
    app = await startMockApp({
      'GET /api/applications': {
        status: 200,
        body: { entries: [{ num: 7, company: 'Acme', status: 'screened' }], count: 1 },
      },
    });
    const res = await callTool('get_tracker');
    expect(res.result.isError).toBeUndefined();
    const data = JSON.parse(res.result.content[0].text);
    expect(data.count).toBe(1);
    expect(data.entries[0].company).toBe('Acme');
  });

  it('get_report returns the detail with markdown and strips the html blob', async () => {
    app = await startMockApp({
      'GET /api/applications/7': {
        status: 200,
        body: {
          num: 7,
          company: 'Acme',
          role: 'Eng',
          score: 4,
          status: 'evaluated',
          report: { fileName: '7.md', markdown: '# Report', html: '<h1>big</h1>' },
        },
      },
    });
    const res = await callTool('get_report', { num: 7 });
    const data = JSON.parse(res.result.content[0].text);
    expect(data.report.markdown).toBe('# Report');
    expect(data.report.html).toBeUndefined();
    expect(data.company).toBe('Acme');
  });

  it('get_report surfaces a missing offer as a clear error', async () => {
    app = await startMockApp({
      'GET /api/applications/99': { status: 404, body: { error: 'Application #99 not found' } },
    });
    const res = await callTool('get_report', { num: 99 });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('#99');
  });

  it('get_report rejects a missing num without calling the app', async () => {
    app = await startMockApp({});
    const res = await callTool('get_report');
    expect(res.result.isError).toBe(true);
    expect(app.requests).toHaveLength(0);
  });

  it('get_profile_summary returns only name, targets, and locations', async () => {
    app = await startMockApp({
      'GET /api/profile': {
        status: 200,
        body: {
          candidate: { full_name: 'Test User', email: 'private@example.com' },
          target_roles: { archetypes: ['Backend Engineer'] },
          search: { terms: ['node'], locations: ['Remote EU'] },
        },
      },
    });
    const res = await callTool('get_profile_summary');
    const data = JSON.parse(res.result.content[0].text);
    expect(data).toEqual({
      name: 'Test User',
      targets: ['Backend Engineer'],
      locations: ['Remote EU'],
    });
    expect(res.result.content[0].text).not.toContain('private@example.com');
  });

  it('get_pipeline and list_jobs relay their routes', async () => {
    app = await startMockApp({
      'GET /api/pipeline': { status: 200, body: { pending: [], screened: [] } },
      'GET /api/jobs/active': { status: 200, body: { evaluate: [] } },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url });
    await client.initialize();
    const pipeline = await client.request(2, 'tools/call', { name: 'get_pipeline', arguments: {} });
    expect(JSON.parse(pipeline.result.content[0].text)).toEqual({ pending: [], screened: [] });
    const jobs = await client.request(3, 'tools/call', { name: 'list_jobs', arguments: {} });
    expect(JSON.parse(jobs.result.content[0].text)).toEqual({ evaluate: [] });
  });

  it('an unreachable app produces the npm run web hint', async () => {
    const res = await callTool('get_tracker'); // app undefined → dead port
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('not reachable');
    expect(res.result.content[0].text).toContain('npm run web');
  });
});
