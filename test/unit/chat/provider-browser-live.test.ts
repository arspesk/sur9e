import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderId } from '@/lib/schemas/providers';
import { writeMcpConfigForTurn } from '@/lib/server/chat/mcp-config';
import { getProvider } from '@/lib/server/providers/registry';
import type { MockApp } from './mcp-test-utils';
import { startMockApp } from './mcp-test-utils';

const LIVE_PROVIDERS = new Set(
  (process.env.SUR9E_PROVIDER_BROWSER_SMOKE ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
);

const CASES: Array<{ id: ProviderId; model: string }> = [
  { id: 'claude', model: 'claude-sonnet-4-6' },
  { id: 'codex', model: 'gpt-5.4-mini' },
  { id: 'opencode', model: 'opencode/deepseek-v4-flash-free' },
];

describe('live provider browser MCP smoke', () => {
  let app: MockApp | undefined;
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const path of temporaryPaths.splice(0)) unlinkSync(path);
  });

  for (const testCase of CASES) {
    const liveIt = LIVE_PROVIDERS.has(testCase.id) ? it : it.skip;
    liveIt(
      `${testCase.id} invokes Playwright and the tracker through its chat adapter`,
      async () => {
        app = await startMockApp({
          'GET /api/applications': {
            status: 200,
            body: { entries: [{ num: 7, company: 'Acme' }], count: 1 },
          },
        });
        const id = randomUUID();
        const promptPath = join(tmpdir(), `sur9e-provider-browser-smoke-${id}.md`);
        const configPath = writeMcpConfigForTurn(process.cwd(), {
          turnId: `provider-browser-smoke-${testCase.id}`,
          appUrl: app.url,
        });
        temporaryPaths.push(promptPath, configPath);
        writeFileSync(
          promptPath,
          'Use the Playwright browser to navigate to https://example.com and read its snapshot. Then call the Sur9e tracker tool. Reply only BROWSER_OK TRACKER_OK if both tools succeed; otherwise state the exact tool failure.',
          'utf-8',
        );

        const provider = getProvider(testCase.id);
        const built = provider.buildChatArgs({
          promptFile: promptPath,
          model: testCase.model,
          sessionId: id,
          mcpConfigPath: configPath,
        });
        const child = spawn(built.cmd, built.args, {
          cwd: process.cwd(),
          detached: true,
          env: { ...process.env, ...built.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => {
          stdout += String(chunk);
        });
        child.stderr.on('data', chunk => {
          stderr += String(chunk);
        });

        const exitCode = await new Promise<number | null>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (child.pid && child.pid > 0) process.kill(-child.pid, 'SIGTERM');
            reject(new Error(`${testCase.id} smoke timed out; stderr: ${stderr.slice(-1000)}`));
          }, 180_000);
          child.once('error', error => {
            clearTimeout(timer);
            reject(error);
          });
          child.once('close', code => {
            clearTimeout(timer);
            resolve(code);
          });
        });

        const toolNames = stdout
          .split('\n')
          .map(line => provider.parseStreamLine(line))
          .filter(event => event?.kind === 'tool')
          .map(event => event?.message.split(':', 1)[0] ?? '');
        expect(exitCode, stderr).toBe(0);
        expect(toolNames.some(name => /playwright|browser_(?:navigate|snapshot)/i.test(name))).toBe(
          true,
        );
        expect(toolNames.some(name => /get_tracker/i.test(name))).toBe(true);
        expect(stdout).toContain('BROWSER_OK TRACKER_OK');
        expect(app.requests.some(request => request.url.startsWith('/api/applications'))).toBe(
          true,
        );
      },
      180_000,
    );
  }
});
