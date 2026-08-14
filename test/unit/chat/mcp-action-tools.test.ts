// test/unit/chat/mcp-action-tools.test.ts
//
// Action tools: confirm-gated relays over the chat action routes.
// Chat context (SUR9E_CHAT_TURN_ID set): the turn header is forwarded
// and terminalApproved is STRIPPED — the confirm card is the only
// approval path. Terminal context: the relay instructs the agent to ask
// the human, then re-call with terminalApproved: true.

import { afterEach, describe, expect, it } from 'vitest';
import { JOB_MODE_IDS } from '@/lib/modes/catalog';
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
      expect.arrayContaining([
        'list_modes',
        'get_mode_instructions',
        'start_workflow',
        'list_workflows',
        'cancel_workflow',
        'start_job',
        'cancel_job',
        'set_status',
        'update_offer',
        'navigate',
      ]),
    );
    const startJob = res.result.tools.find((tool: { name: string }) => tool.name === 'start_job');
    expect([...startJob.inputSchema.properties.kind.enum].sort()).toEqual([...JOB_MODE_IDS].sort());
  });

  it('lists canonical modes and loads inline instructions', async () => {
    app = await startMockApp({
      'GET /api/chat/modes': {
        status: 200,
        body: { modes: [{ id: 'tracker', execution: 'inline' }] },
      },
      'GET /api/chat/modes/tracker': {
        status: 200,
        body: { id: 'tracker', execution: 'inline', instructions: '# Tracker' },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url });
    await client.initialize();

    const listed = await client.request(2, 'tools/call', {
      name: 'list_modes',
      arguments: {},
    });
    const loaded = await client.request(3, 'tools/call', {
      name: 'get_mode_instructions',
      arguments: { mode: 'tracker' },
    });

    expect(JSON.parse(listed.result.content[0].text).modes[0].id).toBe('tracker');
    expect(JSON.parse(loaded.result.content[0].text).instructions).toContain('# Tracker');
  });

  it('starts a selected-offer multi-mode workflow behind one confirmation', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/start-workflow': {
        status: 200,
        body: {
          needsConfirm: true,
          token: 'tok-workflow',
          summary: 'Run 3 modes for offer #7',
          meta: 'screen → evaluate → cover letter',
        },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();

    const res = await client.request(2, 'tools/call', {
      name: 'start_workflow',
      arguments: {
        targets: [{ num: 7 }],
        modes: ['screen', 'evaluate', 'cover-letter'],
        guidance: 'Focus on platform work.',
      },
    });

    expect(JSON.parse(res.result.content[0].text).token).toBe('tok-workflow');
    expect(app.requests[0].body).toEqual({
      targets: [{ num: 7 }],
      modes: ['screen', 'evaluate', 'cover-letter'],
      guidance: 'Focus on platform work.',
    });
  });

  it('requires terminal approval once, then relays a started workflow', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/start-workflow': req =>
        (req.body as Record<string, unknown>).terminalApproved === true
          ? {
              status: 200,
              body: {
                started: true,
                workflow: { id: '0123456789abcdef', status: 'running' },
                jobs: [{ id: 'fedcba9876543210', type: 'evaluate', status: 'queued' }],
              },
            }
          : {
              status: 200,
              body: { needsConfirm: true, summary: 'Run evaluation', meta: 'evaluation' },
            },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url });
    await client.initialize();

    const pending = await client.request(2, 'tools/call', {
      name: 'start_workflow',
      arguments: { targets: [{ num: 7 }], modes: ['evaluate'] },
    });
    const approved = await client.request(3, 'tools/call', {
      name: 'start_workflow',
      arguments: {
        targets: [{ num: 7 }],
        modes: ['evaluate'],
        terminalApproved: true,
      },
    });

    expect(JSON.parse(pending.result.content[0].text).instructions).toContain('terminalApproved');
    expect(JSON.parse(approved.result.content[0].text)).toMatchObject({
      started: true,
      workflow: { id: '0123456789abcdef' },
      jobs: [{ type: 'evaluate' }],
    });
  });

  it('lists and confirmation-gates workflow cancellation', async () => {
    app = await startMockApp({
      'GET /api/workflows': {
        status: 200,
        body: { workflows: [{ id: '0123456789abcdef', status: 'running' }] },
      },
      'POST /api/chat/actions/cancel-workflow': {
        status: 200,
        body: { needsConfirm: true, token: 'tok-cancel-workflow' },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();

    const listed = await client.request(2, 'tools/call', {
      name: 'list_workflows',
      arguments: {},
    });
    const cancelled = await client.request(3, 'tools/call', {
      name: 'cancel_workflow',
      arguments: { workflow_id: '0123456789abcdef' },
    });

    expect(JSON.parse(listed.result.content[0].text).workflows[0].status).toBe('running');
    expect(JSON.parse(cancelled.result.content[0].text).token).toBe('tok-cancel-workflow');
    expect(app.requests[1].body).toEqual({ workflowId: '0123456789abcdef' });
  });

  it('rejects malformed mode-instruction and workflow calls without claiming success', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/start-workflow': {
        status: 400,
        body: { error: 'at least one mode is required' },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url });
    await client.initialize();

    const missingMode = await client.request(2, 'tools/call', {
      name: 'get_mode_instructions',
      arguments: {},
    });
    const malformedWorkflow = await client.request(3, 'tools/call', {
      name: 'start_workflow',
      arguments: { targets: [{ num: 7 }] },
    });

    expect(missingMode.result.isError).toBe(true);
    expect(malformedWorkflow.result.isError).toBe(true);
    expect(malformedWorkflow.result.content[0].text).toContain('at least one mode');
  });

  it('advertises tracked pasted-text screening by offer number', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: 'http://127.0.0.1:9' });
    await client.initialize();
    const res = await client.request(2, 'tools/list');
    const startJob = res.result.tools.find((tool: { name: string }) => tool.name === 'start_job');
    expect(startJob.description).toContain(
      'use screen-evaluate only when the user explicitly asks for both',
    );
    expect(startJob.inputSchema.properties.params.description).toContain(
      'screen or screen-evaluate with { "num": <tracker number> }',
    );
    expect(startJob.inputSchema.properties.params.description).toContain('does not require a URL');
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

  it('create_offer_from_text forwards a source URL for direct evaluation without screening', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/create-offer-from-text': {
        status: 200,
        body: { needsConfirm: true, token: 'tok-url' },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();

    const tools = await client.request(2, 'tools/list');
    const tool = tools.result.tools.find(
      (candidate: { name: string }) => candidate.name === 'create_offer_from_text',
    );
    expect(tool.inputSchema.properties.url).toBeDefined();

    await client.request(3, 'tools/call', {
      name: 'create_offer_from_text',
      arguments: {
        text: 'Build the platform.',
        url: 'https://example.com/jobs/1',
        company: 'Acme',
        role: 'Engineer',
        start_kind: 'evaluate',
      },
    });

    expect(app.requests[0].body).toEqual({
      text: 'Build the platform.',
      url: 'https://example.com/jobs/1',
      company: 'Acme',
      role: 'Engineer',
      startKind: 'evaluate',
    });
  });

  it('create_offer_from_text forwards a multi-mode workflow and not legacy start_kind', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/create-offer-from-text': {
        status: 200,
        body: { needsConfirm: true, token: 'tok-text-workflow' },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();

    await client.request(2, 'tools/call', {
      name: 'create_offer_from_text',
      arguments: {
        text: 'Build the platform.',
        company: 'Acme',
        role: 'Engineer',
        modes: ['screen', 'evaluate'],
      },
    });

    expect(app.requests[0].body).toEqual({
      text: 'Build the platform.',
      company: 'Acme',
      role: 'Engineer',
      modes: ['screen', 'evaluate'],
    });
  });

  it('allows an explicitly requested combined workflow without recommending it', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/create-offer-from-text': {
        status: 200,
        body: {
          needsConfirm: true,
          token: 'tok-workflow',
          summary: 'Create offer from pasted text — Acme · Engineer',
          meta: 'local tracker write · then start screen + evaluate',
        },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();
    const tools = await client.request(2, 'tools/list');
    const tool = tools.result.tools.find(
      (candidate: { name: string }) => candidate.name === 'create_offer_from_text',
    );
    expect(tool.inputSchema.properties.start_kind.enum).toContain('screen-evaluate');
    expect(tool.description).toMatch(/screening and evaluation are separate modes/i);
    expect(tool.description).toContain(
      'screen-evaluate only when the user explicitly asks for both',
    );
    expect(tool.description).not.toContain('recommended');
    expect(tool.inputSchema.properties.start_kind.description).toContain(
      'only when the user explicitly asks for both',
    );

    await client.request(3, 'tools/call', {
      name: 'create_offer_from_text',
      arguments: {
        text: 'Build the platform.',
        company: 'Acme',
        role: 'Engineer',
        start_kind: 'screen-evaluate',
      },
    });
    expect(app.requests[0].body).toMatchObject({ startKind: 'screen-evaluate' });
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

  it('update_offer maps body_edits snake_case and passes fields verbatim', async () => {
    app = await startMockApp({
      'POST /api/chat/actions/update-offer': {
        status: 200,
        body: { needsConfirm: true, token: 't' },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-42' });
    await client.initialize();
    const res = await client.request(2, 'tools/call', {
      name: 'update_offer',
      arguments: {
        num: 42,
        fields: { url: 'https://acme.dev/jobs/1', work_mode: 'Remote' },
        body_edits: [{ old_text: 'Worth applying.', new_text: 'Apply this week.' }],
        summary: 'add source url',
      },
    });
    const data = JSON.parse(res.result.content[0].text);
    expect(data.token).toBe('t');
    expect(app.requests[0].headers['x-sur9e-turn']).toBe('turn-42');
    expect(app.requests[0].body).toEqual({
      num: 42,
      fields: { url: 'https://acme.dev/jobs/1', work_mode: 'Remote' },
      bodyEdits: [{ oldText: 'Worth applying.', newText: 'Apply this week.' }],
      summary: 'add source url',
    });
    // The snake_case wire keys must NOT leak through.
    expect(app.requests[0].body).not.toHaveProperty('body_edits');
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
