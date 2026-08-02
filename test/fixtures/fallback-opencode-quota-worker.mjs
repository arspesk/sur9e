#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { runModeLLM } from '../../batch/lib/llm.mjs';

const [jobRoot, repoRoot, fakeBin, descendantPidFile] = process.argv.slice(2);
const logsDir = join(jobRoot, 'data', 'jobs', 'fallback-opencode-quota-logs');
mkdirSync(logsDir, { recursive: true });

process.env.PATH = `${fakeBin}${delimiter}${process.env.PATH ?? ''}`;
process.env.SUR9E_TEST_DESCENDANT_PID_FILE = descendantPidFile;

const result = await runModeLLM(repoRoot, 'evaluate', 'integration prompt', {
  logsDir,
  runtime: {
    provider: 'opencode',
    model: 'opencode-go/glm-5.2',
    fallback: { provider: 'opencode', model: 'opencode/big-pickle' },
  },
  timeoutMs: 1000,
  tee: true,
});

if (!result.ok) {
  console.error(`ERROR: ${result.error}`);
  process.exitCode = 1;
}
