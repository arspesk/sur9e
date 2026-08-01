import { unlinkSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { readTurnMcpServers, writeMcpConfigForTurn } from '@/lib/server/chat/mcp-config';
import { McpTestClient, type MockApp, startMockApp } from './mcp-test-utils';

const LIVE_SMOKE = process.env.SUR9E_BROWSER_MCP_SMOKE === '1';

describe.runIf(LIVE_SMOKE)('turn-scoped browser MCP smoke', () => {
  const clients: McpTestClient[] = [];
  let app: MockApp | undefined;
  let configPath: string | undefined;

  afterEach(async () => {
    for (const client of clients) client.kill();
    clients.length = 0;
    await app?.close();
    app = undefined;
    if (configPath) unlinkSync(configPath);
    configPath = undefined;
  });

  it('navigates a safe page and reads the tracker through the same turn config', async () => {
    app = await startMockApp({
      'GET /api/applications': {
        status: 200,
        body: { entries: [{ num: 7, company: 'Acme' }], count: 1 },
      },
    });
    configPath = writeMcpConfigForTurn(process.cwd(), {
      turnId: 'browser-smoke',
      appUrl: app.url,
    });
    const servers = readTurnMcpServers(configPath);

    const browser = new McpTestClient(servers.playwright.env, servers.playwright);
    clients.push(browser);
    await browser.initialize();
    const browserTools = await browser.request(2, 'tools/list');
    const names = browserTools.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('browser_navigate');
    expect(names).toContain('browser_snapshot');

    const navigation = await browser.request(3, 'tools/call', {
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' },
    });
    expect(navigation.result.content[0].text).toContain('Example Domain');
    const snapshot = await browser.request(4, 'tools/call', {
      name: 'browser_snapshot',
      arguments: {},
    });
    expect(snapshot.result.content[0].text).toContain('Example Domain');

    const tracker = new McpTestClient(servers['sur9e-app'].env, servers['sur9e-app']);
    clients.push(tracker);
    await tracker.initialize();
    const trackerResult = await tracker.request(2, 'tools/call', {
      name: 'get_tracker',
      arguments: {},
    });
    expect(JSON.parse(trackerResult.result.content[0].text).count).toBe(1);
    expect(app.requests.at(-1)?.headers['x-sur9e-turn']).toBe('browser-smoke');
  }, 60_000);
});
