// test/unit/chat/mcp-test-utils.ts
//
// Shared helpers for driving cli/mcp-app-server.mjs as a real child
// process (newline-delimited JSON-RPC over stdio) and for standing up a
// throwaway node:http server that impersonates the sur9e web app on an
// ephemeral port.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

export const SERVER_PATH = join(process.cwd(), 'cli/mcp-app-server.mjs');

export class McpTestClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private queue: unknown[] = [];
  private waiters: Array<(msg: unknown) => void> = [];
  readonly stderr: string[] = [];

  constructor(env: Record<string, string | undefined> = {}) {
    // Undefined values drop the key from the child env (spawn skips them),
    // so `SUR9E_CHAT_TURN_ID: undefined` guarantees terminal-mode runs.
    this.child = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, SUR9E_CHAT_TURN_ID: undefined, ...env } as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', d => this.stderr.push(String(d)));
    this.child.stdout.on('data', chunk => {
      this.buffer += String(chunk);
      let nl = this.buffer.indexOf('\n');
      while (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) {
          const msg = JSON.parse(line) as unknown;
          const waiter = this.waiters.shift();
          if (waiter) waiter(msg);
          else this.queue.push(msg);
        }
        nl = this.buffer.indexOf('\n');
      }
    });
  }

  send(msg: unknown): void {
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  /** Write a raw (possibly invalid) line — for parse-error tests. */
  sendRaw(line: string): void {
    this.child.stdin.write(`${line}\n`);
  }

  next(timeoutMs = 5000): Promise<any> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`timeout waiting for MCP response; stderr: ${this.stderr.join('')}`)),
        timeoutMs,
      );
      this.waiters.push(msg => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async request(id: number, method: string, params?: unknown): Promise<any> {
    this.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    return this.next();
  }

  /** Full MCP handshake: initialize request + initialized notification. */
  async initialize(): Promise<any> {
    const res = await this.request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0.0.0' },
    });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return res;
  }

  kill(): void {
    this.child.kill('SIGKILL');
  }
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface MockResponse {
  status: number;
  body: unknown;
}

export interface MockApp {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/**
 * Throwaway HTTP stand-in for the web app. `routes` maps 'METHOD /path'
 * to a canned { status, body }, or a function of the recorded request.
 */
export async function startMockApp(
  routes: Record<string, MockResponse | ((req: RecordedRequest) => MockResponse)>,
): Promise<MockApp> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      };
      requests.push(recorded);
      const key = `${recorded.method} ${recorded.url.split('?')[0]}`;
      const route = routes[key];
      const out: MockResponse =
        typeof route === 'function'
          ? route(recorded)
          : (route ?? { status: 404, body: { error: `no mock for ${key}` } });
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}
