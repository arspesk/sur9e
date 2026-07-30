// test/unit/chat/mcp-e2e.test.ts
//
// One MCP session end-to-end against a single server process:
// initialize → initialized → tools/list → list_modes → get_tracker →
// start_workflow → start_job
// (needs_confirm). Complements the per-tool suites by proving the frame
// ordering holds across a whole conversation on one stdio stream.

import { afterEach, describe, expect, it } from 'vitest';
import { McpTestClient, type MockApp, startMockApp } from './mcp-test-utils';

describe('mcp-app-server — full session', () => {
  let client: McpTestClient;
  let app: MockApp;

  afterEach(async () => {
    client?.kill();
    await app?.close();
  });

  it('handshake, discovery, read, and confirm-gated action in one session', async () => {
    app = await startMockApp({
      'GET /api/applications': {
        status: 200,
        body: { entries: [{ num: 7, company: 'Acme', status: 'evaluated' }], count: 1 },
      },
      'GET /api/chat/modes': {
        status: 200,
        body: {
          modes: [{ id: 'screen', execution: 'background', scope: 'offer' }],
          aliases: {},
        },
      },
      'POST /api/chat/actions/start-workflow': {
        status: 200,
        body: {
          needsConfirm: true,
          token: 'tok-workflow',
          summary: 'Run 2 modes for 1 target',
          meta: 'screening → evaluation',
        },
      },
      'POST /api/chat/actions/start-job': {
        status: 200,
        body: {
          needsConfirm: true,
          token: 'tok-e2e',
          summary: 'Start CV tailoring for offer #7',
          meta: 'claude · claude-sonnet-4-6 · ~3–6 min',
        },
      },
    });
    client = new McpTestClient({ SUR9E_APP_URL: app.url, SUR9E_CHAT_TURN_ID: 'turn-e2e' });

    // 1. Handshake
    const init = await client.initialize();
    expect(init.result.serverInfo.name).toBe('sur9e-app');

    // 2. Discovery: every public MCP tool
    const list = await client.request(2, 'tools/list');
    const names = list.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(
      [
        'edit_report',
        'cancel_job',
        'cancel_workflow',
        'create_offer_from_text',
        'get_mode_instructions',
        'get_pipeline',
        'get_profile_summary',
        'get_report',
        'get_tracker',
        'list_jobs',
        'list_modes',
        'list_workflows',
        'navigate',
        'set_status',
        'start_job',
        'start_workflow',
      ].sort(),
    );

    // 3. Canonical mode discovery
    const modes = await client.request(3, 'tools/call', {
      name: 'list_modes',
      arguments: {},
    });
    expect(JSON.parse(modes.result.content[0].text).modes[0].id).toBe('screen');

    // 4. Tracker read
    const tracker = await client.request(4, 'tools/call', {
      name: 'get_tracker',
      arguments: {},
    });
    expect(JSON.parse(tracker.result.content[0].text).count).toBe(1);

    // 5. A multi-mode request receives one workflow confirmation.
    const workflow = await client.request(5, 'tools/call', {
      name: 'start_workflow',
      arguments: {
        targets: [{ num: 7 }],
        modes: ['screen', 'evaluate'],
      },
    });
    const workflowData = JSON.parse(workflow.result.content[0].text);
    expect(workflowData.needsConfirm).toBe(true);
    expect(workflowData.token).toBe('tok-workflow');

    // 6. Single-job confirmation remains backward compatible.
    const start = await client.request(6, 'tools/call', {
      name: 'start_job',
      arguments: { kind: 'tailor-cv', params: { num: 7 } },
    });
    const data = JSON.parse(start.result.content[0].text);
    expect(data.needsConfirm).toBe(true);
    expect(data.token).toBe('tok-e2e');
    expect(data.started).toBeUndefined();
    expect(app.requests.at(-1)?.headers['x-sur9e-turn']).toBe('turn-e2e');

    // Frame ids stayed matched throughout — no interleaving corruption.
    expect([init.id, list.id, modes.id, tracker.id, workflow.id, start.id]).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});
