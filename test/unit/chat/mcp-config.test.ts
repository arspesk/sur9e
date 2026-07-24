// test/unit/chat/mcp-config.test.ts
//
// The per-turn MCP config file is what the spawned provider CLI receives
// via --mcp-config: it launches cli/mcp-app-server.mjs with the turn id,
// app URL, and repo root in env.

import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type McpConfigModule = typeof import('@/lib/server/chat/mcp-config');

describe('writeMcpConfigForTurn', () => {
  let mod: McpConfigModule;
  const savedPort = process.env.PORT;

  beforeEach(async () => {
    vi.resetModules();
    mod = await import('@/lib/server/chat/mcp-config');
  });

  afterEach(() => {
    if (savedPort === undefined) delete process.env.PORT;
    else process.env.PORT = savedPort;
  });

  it('writes a claude-format mcpServers config and returns its path', () => {
    const path = mod.writeMcpConfigForTurn('/repo/root', {
      turnId: 'turn-abc',
      appUrl: 'http://localhost:4000',
    });
    expect(path.startsWith(tmpdir())).toBe(true);
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    expect(config).toEqual({
      mcpServers: {
        'sur9e-app': {
          command: 'node',
          args: [join('/repo/root', 'cli/mcp-app-server.mjs')],
          env: {
            SUR9E_APP_URL: 'http://localhost:4000',
            SUR9E_CHAT_TURN_ID: 'turn-abc',
            SUR9E_ROOT: '/repo/root',
          },
        },
      },
    });
  });

  it('sanitizes hostile turn ids out of the filename', () => {
    const path = mod.writeMcpConfigForTurn('/repo/root', {
      turnId: '../../evil',
      appUrl: 'http://localhost:3000',
    });
    expect(path.startsWith(join(tmpdir(), 'sur9e-mcp'))).toBe(true);
    expect(path).not.toContain('..');
  });

  it('rewriting the same turn id reuses the same path', () => {
    const first = mod.writeMcpConfigForTurn('/repo/root', {
      turnId: 'turn-abc',
      appUrl: 'http://localhost:3000',
    });
    const second = mod.writeMcpConfigForTurn('/repo/root', {
      turnId: 'turn-abc',
      appUrl: 'http://localhost:3000',
    });
    expect(second).toBe(first);
  });

  it('detectAppUrl honors PORT and defaults to 3000', () => {
    delete process.env.PORT;
    expect(mod.detectAppUrl()).toBe('http://localhost:3000');
    process.env.PORT = '4123';
    expect(mod.detectAppUrl()).toBe('http://localhost:4123');
  });
});
