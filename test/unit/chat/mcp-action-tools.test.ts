// test/unit/chat/mcp-action-tools.test.ts
//
// Action tools: confirm-gated relays over the chat action routes.
// Chat context (SUR9E_CHAT_TURN_ID set): the turn header is forwarded
// and terminalApproved is STRIPPED — the confirm card is the only
// approval path. Terminal context: the relay instructs the agent to ask
// the human, then re-call with terminalApproved: true.

import { afterEach, describe, expect, it } from 'vitest';
import { McpTestClient, type MockApp, startMockApp } from './mcp-test-utils';

const CONFIRM_RESPONSE = {
  status: 200,
  body: {
    needsConfirm: true,
    token: 'tok-1',
    summary: 'Start evaluation for offer #7',
    meta: 'claude · claude-sonnet-4-6 · ~7–15 min',
  },
};

describe('mcp-app-server — action tools', () => {
  let client: McpTestClient;
  let app: MockApp | undefined;

  afterEach(async () => {
    client?.kill();
    await app?.close();
    app = undefined;
  });

  it('tools/list advertises the action tools', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: 'http://127.0.0.1:9' });
    await client.initialize();
    const res = await client.request(2, 'tools/list');
    const names = res.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['start_job', 'cancel_job', 'set_status', 'edit_report', 'navigate']),
    );
  });

  it('create_offer_from_text forwards text identity and optional job in one confirmation', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/create-offer-from-text': {
        status: 200,
        body: {
          needsConfirm: true,
          token: 'tok-text',
          summary: 'Create offer from pasted text — Acme · Engineer',
          meta: 'local tracker write · then start CV tailoring',
        },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'create_offer_from_text',
      arguments: {
        text: 'Build the platform.',
        company: 'Acme',
        role: 'Engineer',
        start_kind: 'tailor-cv',
      },
    });
    const data = JSON.parse(res.result.content[0].text);
    expect(data.token).toBe('tok-text');
    expect(data.instructions).toMatch(/confirmation card/i);
    expect(app.requests[0].body).toEqual({
      text: 'Build the platform.',
      company: 'Acme',
      role: 'Engineer',
      startKind: 'tailor-cv',
    });
  });

  it('cancel_job forwards one exact job id through the confirmation gate', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/cancel-job': {
        status: 200,
        body: {
          needsConfirm: true,
          token: 'tok-cancel',
          summary: 'Cancel evaluation for offer #7',
          meta: 'job 0123456789abcdef',
        },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'cancel_job',
      arguments: { job_id: '0123456789abcdef' },
    });
    const data = JSON.parse(res.result.content[0].text);
    expect(data.token).toBe('tok-cancel');
    expect(data.instructions).toMatch(/confirmation card/i);
    expect(app.requests[0].body).toEqual({ jobId: '0123456789abcdef' });
  });

  it('edit_report maps old_text→oldText / new_text→newText in the forwarded body', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/edit-report': {
        status: 200,
        body: { needsConfirm: true, token: 'tok-edit', summary: 'Edit report #7', meta: 'm' },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'edit_report',
      arguments: { num: 7, old_text: 'old snippet', new_text: 'new snippet', summary: 'tighten' },
    });
    const data = JSON.parse(res.result.content[0].text);
    expect(data.token).toBe('tok-edit');
    expect(data.instructions).toMatch(/confirmation card/i);
    expect(app.requests[0].headers['x-sur9e-turn']).toBe('turn-42');
    expect(app.requests[0].body).toMatchObject({
      num: 7,
      oldText: 'old snippet',
      newText: 'new snippet',
      summary: 'tighten',
    });
    // The snake_case wire keys must NOT leak through.
    expect(app.requests[0].body).not.toHaveProperty('old_text');
  });

  it('start_job in chat context forwards the turn header and relays the confirm card', async () => {
    app = await startMockApp({ 'POST /api/chat/actions/start-job': CONFIRM_RESPONSE });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'start_job',
      arguments: { kind: 'evaluate', params: { num: 7 } },
    });
    const data = JSON.parse(res.result.content[0].text);
    expect(data.needsConfirm).toBe(true);
    expect(data.token).toBe('tok-1');
    expect(data.instructions).toMatch(/confirmation card/i);
    expect(app.requests[0].headers['x-sur9e-turn']).toBe('turn-42');
    expect(app.requests[0].body).toMatchObject({ kind: 'evaluate', params: { num: 7 } });
  });

  it('start_job in chat context strips terminalApproved before forwarding', async () => {
    app = await startMockApp({ 'POST /api/chat/actions/start-job': CONFIRM_RESPONSE });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();
    await client.request(2, 'tools/call', {
      name: 'start_job',
      arguments: { kind: 'evaluate', params: { num: 7 }, terminalApproved: true },
    });
    expect((app.requests[0].body as Record<string, unknown>).terminalApproved).toBeUndefined();
  });

  it('start_job in terminal context instructs the agent to ask the user', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/start-job': {
        status: 200,
        body: { needsConfirm: true, summary: 'Start evaluation for offer #7', meta: 'm' },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'start_job',
      arguments: { kind: 'evaluate', params: { num: 7 } },
    });
    const data = JSON.parse(res.result.content[0].text);
    expect(data.needsConfirm).toBe(true);
    expect(data.instructions).toContain('terminalApproved');
    expect(app.requests[0].headers['x-sur9e-turn']).toBeUndefined();
  });

  it('start_job terminal + approval forwards the flag and relays the started job', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/start-job': req =>
        (req.body as Record<string, unknown>).terminalApproved === true
          ? { status: 200, body: { started: true, job: { id: 'j1', type: 'evaluate' } } }
          : { status: 200, body: { needsConfirm: true, summary: 's', meta: 'm' } },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'start_job',
      arguments: { kind: 'evaluate', params: { num: 7 }, terminalApproved: true },
    });
    const data = JSON.parse(res.result.content[0].text);
    expect(data.started).toBe(true);
    expect(data.job.id).toBe('j1');
  });

  it('set_status in chat context relays the confirm card', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/set-status': {
        status: 200,
        body: {
          needsConfirm: true,
          token: 'tok-2',
          summary: 'Set offer #7 status to "applied"',
          meta: 'm',
        },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'set_status',
      arguments: { num: 7, status: 'applied' },
    });
    const data = JSON.parse(res.result.content[0].text);
    expect(data.token).toBe('tok-2');
    expect(data.instructions).toMatch(/confirmation card/i);
    expect(app.requests[0].body).toMatchObject({ num: 7, status: 'applied' });
  });

  it('navigate in chat context posts the path', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/navigate': { status: 200, body: { ok: true } },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'navigate',
      arguments: { path: '/table' },
    });
    expect(JSON.parse(res.result.content[0].text)).toEqual({ ok: true });
    expect(app.requests[0].body).toEqual({ path: '/table' });
  });

  it('navigate in terminal context returns guidance without calling the app', async () => {
    app = await startMockApp({});
    client = new McpTestClient({ SUR9E_APP_URL: app.url });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'navigate',
      arguments: { path: '/table' },
    });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('web chat');
    expect(app.requests).toHaveLength(0);
  });

  it('a route validation failure surfaces as an error result', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/start-job': {
        status: 400,
        body: { error: 'kind "evaluate" requires params.num (integer tracker number)' },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'start_job',
      arguments: { kind: 'evaluate' },
    });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('params.num');
  });
});
