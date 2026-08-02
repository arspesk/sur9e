// src/lib/server/chat/mcp-config.ts
//
// Per-turn MCP config generation. The chat turn runner passes the
// returned path to the spawned provider CLI, wiring a read-only Playwright
// reader plus the sur9e-app MCP server (cli/mcp-app-server.mjs) into the turn
// with the turn id, app URL, and repo root in env.

import 'server-only';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PLAYWRIGHT_CHAT_TOOLS = Object.freeze([
  'browser_navigate',
  'browser_snapshot',
  'browser_wait_for',
  'browser_tabs',
  'browser_console_messages',
  'browser_network_requests',
] as const);

const PLAYWRIGHT_SERVER: TurnMcpServer = {
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated'],
  env: {},
};

/** Base URL of the running web app for this process. */
export function detectAppUrl(): string {
  return process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000';
}

export interface McpConfigOptions {
  turnId: string;
  appUrl: string;
}

/**
 * Write the claude-format MCP config for one chat turn and return its
 * absolute path. Same turn id → same path (safe to rewrite). Files live
 * under the OS tmpdir — they are turn-scoped throwaways, not user data.
 */
export function writeMcpConfigForTurn(root: string, opts: McpConfigOptions): string {
  const dir = join(tmpdir(), 'sur9e-mcp');
  mkdirSync(dir, { recursive: true });
  const safeTurnId = opts.turnId.replace(/[^A-Za-z0-9-]/g, '_');
  const path = join(dir, `turn-${safeTurnId}.json`);
  const config = {
    mcpServers: {
      playwright: {
        command: PLAYWRIGHT_SERVER.command,
        args: PLAYWRIGHT_SERVER.args,
      },
      'sur9e-app': {
        command: 'node',
        args: [join(root, 'cli/mcp-app-server.mjs')],
        env: {
          SUR9E_APP_URL: opts.appUrl,
          SUR9E_CHAT_TURN_ID: opts.turnId,
          SUR9E_ROOT: root,
        },
      },
    },
  };
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
  return path;
}

/** The sur9e-app server block, lifted back out of a turn's MCP config file. */
export interface TurnMcpServer {
  /** Server executable (`node`, `npx`, etc.). */
  command: string;
  /** argv for the executable. */
  args: string[];
  /** Per-server environment; the app server uses it to carry the turn id. */
  env: Record<string, string>;
}

/** Read every known server from the generated per-turn config. */
export function readTurnMcpServers(path: string): Record<string, TurnMcpServer> {
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf-8')) as {
      mcpServers?: Record<string, { command?: unknown; args?: unknown; env?: unknown }>;
    };
    const servers: Record<string, TurnMcpServer> = {};
    for (const name of ['playwright', 'sur9e-app']) {
      const server = cfg.mcpServers?.[name];
      if (!server || typeof server.command !== 'string' || !Array.isArray(server.args)) continue;
      const rawEnv = server.env;
      const env =
        rawEnv && typeof rawEnv === 'object'
          ? Object.fromEntries(Object.entries(rawEnv).map(([key, value]) => [key, String(value)]))
          : {};
      servers[name] = { command: server.command, args: server.args.map(String), env };
    }
    return servers;
  } catch {
    return {};
  }
}

/**
 * Read the sur9e-app server block back out of a claude-format turn MCP config
 * (the file `writeMcpConfigForTurn` produced).
 *
 * The claude adapter consumes the config file directly (--mcp-config). codex
 * and opencode can't point at a claude-format file — they express a
 * turn-scoped MCP server in their own CLI's config shape (a `-c` TOML override
 * and an OPENCODE_CONFIG JSON block, respectively). Rather than teach the turn
 * runner to hand each adapter provider-specific inputs, those adapters lift the
 * command + turn-id env straight out of the file the runner already wrote via
 * this reader, then re-express it. That keeps the turn id (the value the action
 * routes need to emit a confirm card) flowing without touching the runner.
 *
 * Returns null on any read/parse failure or when SUR9E_CHAT_TURN_ID is absent
 * (a config with no turn id is a terminal-mode config — nothing to wire).
 */
export function readTurnMcpConfig(path: string): TurnMcpServer | null {
  const server = readTurnMcpServers(path)['sur9e-app'];
  return server?.env.SUR9E_CHAT_TURN_ID ? server : null;
}
