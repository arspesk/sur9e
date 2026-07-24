// test/unit/chat/mcp-protocol.test.ts
//
// Protocol-level tests for cli/mcp-app-server.mjs: spawn the real
// script, speak newline-delimited JSON-RPC 2.0 over its stdio, assert
// the MCP handshake and error frames. No HTTP calls happen here — the
// app URL points at a closed port on purpose.

import { afterEach, describe, expect, it } from 'vitest';
import { McpTestClient } from './mcp-test-utils';

const DEAD_APP = 'http://127.0.0.1:9';

describe('mcp-app-server — protocol core', () => {
  let client: McpTestClient;

  afterEach(() => {
    client?.kill();
  });

  it('answers initialize with the MCP handshake shape', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: DEAD_APP });
    const res = await client.request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0.0.0' },
    });
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe('2025-06-18');
    expect(res.result.capabilities).toEqual({ tools: {} });
    expect(res.result.serverInfo).toEqual({ name: 'sur9e-app', version: '1.0.0' });
  });

  it('ignores notifications/initialized (no reply) and then answers ping', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: DEAD_APP });
    await client.initialize();
    const pong = await client.request(2, 'ping');
    expect(pong.id).toBe(2); // proves the notification produced no frame
    expect(pong.result).toEqual({});
  });

  it('answers tools/list with a tools array', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: DEAD_APP });
    await client.initialize();
    const res = await client.request(2, 'tools/list');
    expect(Array.isArray(res.result.tools)).toBe(true);
  });

  it('returns -32601 for an unknown method', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: DEAD_APP });
    await client.initialize();
    const res = await client.request(2, 'resources/list');
    expect(res.error.code).toBe(-32601);
  });

  it('returns -32700 with id null for a non-JSON line', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: DEAD_APP });
    client.sendRaw('this is not json');
    const res = await client.next();
    expect(res.error.code).toBe(-32700);
    expect(res.id).toBe(null);
  });

  it('returns -32602 for tools/call with an unknown tool', async () => {
    client = new McpTestClient({ SUR9E_APP_URL: DEAD_APP });
    await client.initialize();
    const res = await client.request(2, 'tools/call', { name: 'no_such_tool', arguments: {} });
    expect(res.error.code).toBe(-32602);
  });
});
