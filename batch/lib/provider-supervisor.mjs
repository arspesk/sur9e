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

let terminating = false;
function terminateGroup() {
  if (terminating) return;
  terminating = true;
  try {
    // The supervisor is spawned detached and is therefore its process-group
    // leader. SIGKILL the group so the provider and every tool it spawned die
    // even when the worker parent disappeared without running cleanup.
    process.kill(-process.pid, 'SIGKILL');
  } catch {
    process.exit(1);
  }
}

function remainingGroupMembers() {
  const result = spawnSync('ps', ['-o', 'pid=', '-o', 'stat=', '-g', String(process.pid)], {
    encoding: 'utf8',
    detached: true,
  });
  if (result.status !== 0) throw new Error('could not verify provider process group cleanup');
  return String(result.stdout ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [pid, state = ''] = line.trim().split(/\s+/, 2);
      return { pid: Number(pid), state };
    })
    .filter(member =>
      Number.isInteger(member.pid) && member.pid > 1 && member.pid !== process.pid
    );
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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function cleanupRemainingGroupMembers() {
  const freezeDeadline = Date.now() + 500;

  while (Date.now() < freezeDeadline) {
    const members = remainingGroupMembers();
    if (members.length === 0) return;

    // Stop every known member before killing any of them. Re-enumerate until
    // membership is stable and every member is stopped (or already a zombie),
    // closing the window in which a surviving helper could fork another child.
    signalMembers(members, 'SIGSTOP');
    await delay(5);
    const verified = remainingGroupMembers();
    const targeted = new Set(members.map(member => member.pid));
    const frozen = verified.every(
      member => targeted.has(member.pid) && /[TZ]/.test(member.state),
    );
    if (!frozen) continue;

    signalMembers(verified, 'SIGKILL');
    const reapDeadline = Date.now() + 1000;
    while (Date.now() < reapDeadline) {
      if (remainingGroupMembers().length === 0) return;
      await delay(10);
    }
    throw new Error('provider descendants did not terminate');
  }

  throw new Error('provider descendants could not be frozen');
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, terminateGroup);
}

const provider = spawn(command, args, {
  stdio: ['ignore', 'inherit', 'inherit'],
});

const parentWatch = setInterval(() => {
  if (process.ppid !== expectedParentPid) terminateGroup();
}, 100);

provider.on('error', error => {
  clearInterval(parentWatch);
  console.error(error.message);
  process.exit(1);
});

provider.on('close', async (code, signal) => {
  // A provider wrapper can exit while a tool/daemon it spawned remains in the
  // group. Freeze and remove those descendants before reporting the provider's
  // real exit status, so success remains success and fallback cannot overlap it.
  try {
    await cleanupRemainingGroupMembers();
  } catch {
    terminateGroup();
    return;
  }
  clearInterval(parentWatch);
  if (signal) {
    process.exit(1);
  } else {
    process.exit(code ?? 1);
  }
});
