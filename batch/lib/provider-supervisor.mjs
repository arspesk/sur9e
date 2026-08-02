#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';

const separator = process.argv.indexOf('--');
const parentIndex = process.argv.indexOf('--parent-pid');
const expectedParentPid = Number(parentIndex >= 0 ? process.argv[parentIndex + 1] : 0);
const command = separator >= 0 ? process.argv[separator + 1] : '';
const args = separator >= 0 ? process.argv.slice(separator + 2) : [];

if (!command || !Number.isInteger(expectedParentPid) || expectedParentPid <= 1) {
  console.error('provider-supervisor: expected --parent-pid <pid> -- <command> [args...]');
  process.exit(2);
}

const provider = spawn(command, args, {
  stdio: ['ignore', 'inherit', 'inherit'],
  // Keep the supervisor outside the provider group. It can then atomically
  // SIGKILL the provider and all descendants without losing its own exit code.
  detached: true,
});

const CLEANUP_FAILED_MARKER = '[SUR9E_PROVIDER_CLEANUP_FAILED]';
const GROUP_EXIT_GRACE_MS = 1000;
const GROUP_POLL_MS = 10;
let terminating = false;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function providerGroupHasLiveMembers() {
  if (!Number.isInteger(provider.pid) || provider.pid <= 1) return false;
  // BSD ps and procps disagree about `-g`. Enumerate explicitly and filter by
  // PGID so this check means the same thing on macOS and Linux. A zombie has
  // already received SIGKILL and cannot execute or fork, so it is safe for the
  // supervisor to leave reaping to the OS while still blocking on D/T/R/S/etc.
  const result = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'pgid=', '-o', 'stat='], {
    encoding: 'utf8',
    detached: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ps failed while verifying provider cleanup`);
  return String(result.stdout ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .some(line => {
      const [pid, pgid, state = ''] = line.trim().split(/\s+/, 3);
      return Number(pid) > 1 && Number(pgid) === provider.pid && !state.includes('Z');
    });
}

function killProviderGroup() {
  if (!Number.isInteger(provider.pid) || provider.pid <= 1) return;
  try {
    process.kill(-provider.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function killProviderGroupAndWait() {
  killProviderGroup();
  const deadline = Date.now() + GROUP_EXIT_GRACE_MS;
  while (providerGroupHasLiveMembers() && Date.now() < deadline) {
    await delay(GROUP_POLL_MS);
  }
  if (providerGroupHasLiveMembers()) {
    throw new Error('provider process group did not terminate');
  }
}

function exitForCleanupFailure(error) {
  console.error(`${CLEANUP_FAILED_MARKER} ${error?.message ?? 'provider cleanup failed'}`);
  process.exit(1);
}

async function terminateProviderGroup() {
  if (terminating) return;
  terminating = true;
  try {
    await killProviderGroupAndWait();
    process.exit(1);
  } catch (error) {
    exitForCleanupFailure(error);
  }
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => void terminateProviderGroup());
}

const parentWatch = setInterval(() => {
  if (process.ppid !== expectedParentPid) void terminateProviderGroup();
}, 100);

provider.on('error', error => {
  clearInterval(parentWatch);
  console.error(error.message);
  process.exit(1);
});

provider.on('close', async (code, signal) => {
  if (terminating) return;
  terminating = true;
  clearInterval(parentWatch);
  // A provider wrapper can exit while a tool/daemon it spawned remains in the
  // provider group. The supervisor lives in a different group, so this atomic
  // kill preserves the provider's exit status while preventing overlap with a
  // fallback attempt.
  try {
    await killProviderGroupAndWait();
  } catch (error) {
    exitForCleanupFailure(error);
    return;
  }
  if (signal) {
    process.exit(1);
  } else {
    process.exit(code ?? 1);
  }
});
