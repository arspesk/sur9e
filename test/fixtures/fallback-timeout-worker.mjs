#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runModeLLM } from '../../batch/lib/llm.mjs';

const [rootPath, descendantPidFile, timeoutArg, primaryExitDelayArg] = process.argv.slice(2);
const logsDir = join(rootPath, 'data', 'jobs', 'fallback-timeout-logs');
mkdirSync(logsDir, { recursive: true });

const primaryScript = String.raw`
  const { spawn } = require('node:child_process');
  const { writeFileSync } = require('node:fs');
  const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  writeFileSync(process.argv[1], String(descendant.pid));
  process.stdout.write('> build · glm-5.2\n');
  const exitDelay = Number(process.argv[2]);
  if (exitDelay > 0) setTimeout(() => process.exit(1), exitDelay);
  setInterval(() => {}, 1000);
`;

const execImpl = (_cmd, args) => {
  const providerIndex = args.indexOf('--platform');
  const provider = providerIndex >= 0 ? args[providerIndex + 1] : '';
  const spawn =
    provider === 'opencode'
      ? {
          cmd: process.execPath,
          args: ['-e', primaryScript, descendantPidFile, primaryExitDelayArg ?? '0'],
        }
      : {
          cmd: process.execPath,
          args: ['-e', "process.stdout.write('fallback completed\\n')"],
        };
  return {
    status: 0,
    signal: null,
    stdout: JSON.stringify(spawn),
    stderr: '',
  };
};

const result = await runModeLLM(rootPath, 'evaluate', 'integration prompt', {
  logsDir,
  runtime: {
    provider: 'opencode',
    model: 'opencode-go/glm-5.2',
    fallback: { provider: 'claude', model: 'claude-sonnet-5' },
  },
  timeoutMs: Number(timeoutArg) || 1200,
  execImpl,
  tee: true,
});

if (!result.ok) {
  console.error(`ERROR: ${result.error}`);
  process.exitCode = 1;
}
