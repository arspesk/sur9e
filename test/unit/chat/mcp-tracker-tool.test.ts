// test/unit/chat/mcp-tracker-tool.test.ts
//
// get_tracker server-side filtering (issues #104/#107): the tool declares
// filter/pagination arguments, always requests the compact projection
// (fields=compact), and relays the paginated payload — so the model never
// pulls the full 1.7 MB tracker through the tool-output limit again.

import { afterEach, describe, expect, it } from 'vitest';
import { McpTestClient, type MockApp, startMockApp } from './mcp-test-utils';

const CANONICAL_STATUSES = [
  'screened',
  'evaluated',
  'applied',
  'responded',
  'interview',
  'offer',
  'rejected',
  'discarded',
];

describe('mcp-app-server — get_tracker filters', () => {
  let client: McpTestClient;
  let app: MockApp | undefined;

  afterEach(async () => {
    client?.kill();
    await app?.close();
    app = undefined;
  });

  async function callGetTracker(args: Record<string, unknown> = {}) {
    client = new McpTestClient({ SUR9E_APP_URL: app?.url ?? 'http://127.0.0.1:9' });
    await client.initialize();
    return client.request(2, 'tools/call', { name: 'get_tracker', arguments: args });
  }

  function requestedParams(): URLSearchParams {
    expect(app?.requests).toHaveLength(1);
    return new URL(app?.requests[0].url ?? '', 'http://localhost').searchParams;
  }

  it('declares the filter and pagination arguments on its input schema', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: 'http://127.0.0.1:9' });
    await client.initialize();
    const res = await client.request(2, 'tools/list');
    const tool = res.result.tools.find((t: { name: string }) => t.name === 'get_tracker');
    expect(tool).toBeTruthy();
    expect(tool.inputSchema.additionalProperties).toBe(false);
    const props = tool.inputSchema.properties;
    for (const key of [
      'status',
      'location',
      'work_mode',
      'company',
      'role',
      'min_score',
      'since',
      'until',
      'limit',
      'offset',
    ]) {
      expect(props, `missing inputSchema property ${key}`).toHaveProperty(key);
    }
    expect(props.status.items.enum).toEqual(CANONICAL_STATUSES);
    expect(tool.inputSchema.required).toBeUndefined();
    // The description must steer the model toward server-side filtering
    // and pagination instead of dumping the whole tracker.
    expect(tool.description).toContain('next_offset');
    expect(tool.description).toContain('get_report');
  });

  it('requests the compact projection even with no arguments', async () => {
    app = await startMockApp({
      'GET /api/applications': {
        status: 200,
        body: { entries: [], total: 0, count: 0, next_offset: null },
      },
    });
    const res = await callGetTracker();
    expect(res.result.isError).toBeUndefined();
    expect(requestedParams().get('fields')).toBe('compact');
  });

  it('passes every filter through as snake_case query params', async () => {
    app = await startMockApp({
      'GET /api/applications': {
        status: 200,
        body: { entries: [], total: 0, count: 0, next_offset: null },
      },
    });
    await callGetTracker({
      status: ['applied', 'interview'],
      location: 'Barcelona',
      work_mode: 'Hybrid',
      company: 'Acme',
      role: 'engineer',
      min_score: 4,
      since: '2026-07-01',
      until: '2026-08-01',
      limit: 50,
      offset: 100,
    });
    const params = requestedParams();
    expect(params.get('fields')).toBe('compact');
    expect(params.get('status')).toBe('applied,interview');
    expect(params.get('location')).toBe('Barcelona');
    expect(params.get('work_mode')).toBe('Hybrid');
    expect(params.get('company')).toBe('Acme');
    expect(params.get('role')).toBe('engineer');
    expect(params.get('min_score')).toBe('4');
    expect(params.get('since')).toBe('2026-07-01');
    expect(params.get('until')).toBe('2026-08-01');
    expect(params.get('limit')).toBe('50');
    expect(params.get('offset')).toBe('100');
  });

  it('relays the paginated compact payload verbatim', async () => {
    const payload = {
      entries: [
        {
          num: 7,
          date: '2026-07-01',
          company: 'Acme',
          role: 'Eng',
          score: '4.2/5',
          status: 'applied',
          url: 'https://jobs.acme.dev/x',
        },
      ],
      total: 251,
      count: 1,
      next_offset: 201,
    };
    app = await startMockApp({ 'GET /api/applications': { status: 200, body: payload } });
    const res = await callGetTracker({ status: ['applied'], limit: 1, offset: 200 });
    expect(res.result.isError).toBeUndefined();
    expect(JSON.parse(res.result.content[0].text)).toEqual(payload);
  });

  it('surfaces an app-side validation error as a tool error', async () => {
    app = await startMockApp({
      'GET /api/applications': { status: 400, body: { error: 'Invalid query param min_score' } },
    });
    const res = await callGetTracker({ min_score: 4 });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('Invalid query param min_score');
  });
});
