#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';

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
});

const CLEANUP_FAILED_MARKER = '[SUR9E_PROVIDER_CLEANUP_FAILED]';
const GROUP_EXIT_GRACE_MS = 1000;
const GROUP_POLL_MS = 10;
let terminating = false;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function remainingGroupMembers() {
  // BSD ps and procps disagree about `-g`. Enumerate explicitly and filter by
  // PGID so this query means the same thing on macOS and Linux.
  const result = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'pgid=', '-o', 'stat='], {
    encoding: 'utf8',
    detached: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('ps failed while verifying provider cleanup');
  return String(result.stdout ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [pid, pgid, state = ''] = line.trim().split(/\s+/, 3);
      return { pid: Number(pid), pgid: Number(pgid), state };
    })
    .filter(member =>
      Number.isInteger(member.pid) &&
      member.pid > 1 &&
      member.pid !== process.pid &&
      member.pgid === process.pid
    );
}

function liveGroupMembers() {
  // Zombies have already received their terminal signal and cannot execute or
  // fork. Reaping them is the OS's responsibility; every other state blocks a
  // fallback from starting.
  return remainingGroupMembers().filter(member => !member.state.includes('Z'));
}

function signalMembers(members, signal) {
  for (const { pid } of members) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

function terminateGroup() {
  if (terminating) return;
  terminating = true;
  try {
    // The supervisor is the detached process-group leader and the provider
    // inherits this group. One uncatchable signal therefore reaches the
    // supervisor, provider wrapper, and every non-detached descendant.
    process.kill(-process.pid, 'SIGKILL');
  } catch {
    process.exit(1);
  }
}

async function cleanupRemainingGroupMembers() {
  const freezeDeadline = Date.now() + 500;
  let pollMs = GROUP_POLL_MS;

  while (Date.now() < freezeDeadline) {
    const members = liveGroupMembers();
    if (members.length === 0) return;

    // Freeze every known member and re-enumerate until the set is stable. Once
    // all live members are stopped, none can fork between verification and the
    // final individual SIGKILL pass (which leaves the supervisor alive).
    signalMembers(members, 'SIGSTOP');
    await delay(5);
    const verified = liveGroupMembers();
    const targeted = new Set(members.map(member => member.pid));
    const frozen = verified.every(
      member => targeted.has(member.pid) && member.state.includes('T'),
    );
    if (!frozen) {
      await delay(pollMs);
      pollMs = Math.min(pollMs * 2, 100);
      continue;
    }

    signalMembers(verified, 'SIGKILL');
    const exitDeadline = Date.now() + GROUP_EXIT_GRACE_MS;
    pollMs = GROUP_POLL_MS;
    while (Date.now() < exitDeadline) {
      if (liveGroupMembers().length === 0) return;
      await delay(pollMs);
      pollMs = Math.min(pollMs * 2, 100);
    }
    throw new Error('provider process group did not terminate');
  }

  throw new Error('provider process group could not be frozen');
}

function exitForCleanupFailure(error) {
  try {
    writeSync(2, `${CLEANUP_FAILED_MARKER} ${error?.message ?? 'provider cleanup failed'}\n`);
  } catch {}
  terminateGroup();
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, terminateGroup);
}

const parentWatch = setInterval(() => {
  if (process.ppid !== expectedParentPid) terminateGroup();
}, 100);

provider.on('error', error => {
  clearInterval(parentWatch);
  console.error(error.message);
  process.exit(1);
});

provider.on('close', async (code, signal) => {
  if (terminating) return;
  // A provider wrapper can exit while a tool/daemon it spawned remains in the
  // group. Remove those descendants before forwarding the wrapper's real exit
  // status; parent-death monitoring stays active throughout this cleanup.
  try {
    await cleanupRemainingGroupMembers();
  } catch (error) {
    exitForCleanupFailure(error);
    return;
  }
  if (terminating) return;
  terminating = true;
  clearInterval(parentWatch);
  if (signal) {
    process.exit(1);
  } else {
    process.exit(code ?? 1);
  }
});
