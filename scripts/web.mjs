#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// sur9e web launcher — dev/prod server with optional Tailscale exposure.
//
// Named npm scripts wrap the common invocations (no `--` needed):
//   npm run web            start dev   (= node scripts/web.mjs)
//   npm run web:prod       start prod  (build + serve)
//   npm run web:tailscale  start prod + tailscale serve
//   npm run web:status     report the :3000 listener / managed state / URLs
//   npm run web:stop       stop the managed server, reset tailscale serve
//
// Or compose flags directly (npm run web -- …):
//   (default)   start  [--prod] [--dev] [--tailscale] [--detach]
//   status      report the :3000 listener / managed state / URLs
//   stop        stop the managed server, reset tailscale serve
//
// State lives under data/web/ (gitignored): web.pid, web.json, web.log.
// This script NEVER kills a server it did not start, and only ever uses
// `tailscale serve` (tailnet-internal) — never funnel.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Exported so the runtime commands (and any caller) can resolve the
// launcher's gitignored state dir; also keeps Biome from flagging it unused
// until the runtime section that consumes it lands.
export const DEFAULT_STATE_DIR = join(ROOT, 'data', 'web');
const PORT = 3000;
// The local next binary — spawned directly (never through npx, which does
// not reliably forward SIGTERM to its child; see runForeground).
const NEXT_BIN = join(ROOT, 'node_modules', '.bin', 'next');
const TAILSCALE_APP_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

function defaultExec(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf-8', ...opts });
}

/** Parse argv (after `node scripts/web.mjs`) into a command description. */
export function parseWebArgs(argv) {
  const out = { command: 'start', prod: false, tailscale: false, detach: false };
  let dev = false;
  for (const arg of argv) {
    // 'start' is the default but accepted explicitly — the header documents
    // it as a subcommand, so typing it must not be an error.
    if (arg === 'start' || arg === 'status' || arg === 'stop') out.command = arg;
    else if (arg === '--prod') out.prod = true;
    else if (arg === '--dev') dev = true;
    else if (arg === '--tailscale') out.tailscale = true;
    else if (arg === '--detach') out.detach = true;
    else
      throw new Error(
        `Unknown argument: ${arg} (expected start | status | stop | --prod | --dev | --tailscale | --detach)`,
      );
  }
  if (dev && out.prod) throw new Error('--dev and --prod are mutually exclusive');
  // Tailnet exposure defaults to prod: remote devices want built pages, not
  // an HMR websocket through the proxy. `--dev` is the explicit override
  // (e.g. testing dev-only behavior from another machine).
  if (out.tailscale && !dev) out.prod = true;
  if (out.command !== 'start' && (out.prod || out.tailscale || out.detach)) {
    throw new Error(`Flags only apply to start, not ${out.command}`);
  }
  return out;
}

/** PID + command of the :3000 listener, or null. lsof exits 1 on no match. */
export function getListener({ exec = defaultExec } = {}) {
  const res = exec('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-Fpc']);
  if (res.status !== 0 || !res.stdout) return null;
  const pid = /^p(\d+)$/m.exec(res.stdout)?.[1];
  const command = /^c(.+)$/m.exec(res.stdout)?.[1] ?? 'unknown';
  return pid ? { pid: Number(pid), command } : null;
}

/** Tailscale CLI path: PATH first, then the macOS app bundle. Null when absent. */
export function findTailscaleCli({ exec = defaultExec, exists = existsSync } = {}) {
  const which = exec('which', ['tailscale']);
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  if (exists(TAILSCALE_APP_CLI)) return TAILSCALE_APP_CLI;
  return null;
}

/** https URL of this machine on the tailnet, or null (no CLI / not up). */
export function getTailnetUrl({ exec = defaultExec, exists = existsSync } = {}) {
  const cli = findTailscaleCli({ exec, exists });
  if (!cli) return null;
  const res = exec(cli, ['status', '--json']);
  if (res.status !== 0) return null;
  try {
    const dns = JSON.parse(res.stdout)?.Self?.DNSName;
    return dns ? `https://${dns.replace(/\.$/, '')}` : null;
  } catch {
    return null;
  }
}

// ── State files (all under stateDir; injectable so tests never touch data/) ──

function pidFile(stateDir) {
  return join(stateDir, 'web.pid');
}
function metaFile(stateDir) {
  return join(stateDir, 'web.json');
}
function logFile(stateDir) {
  return join(stateDir, 'web.log');
}

function readPid(stateDir) {
  try {
    const n = Number(readFileSync(pidFile(stateDir), 'utf-8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function readMeta(stateDir) {
  try {
    return JSON.parse(readFileSync(metaFile(stateDir), 'utf-8'));
  } catch {
    return null;
  }
}

function clearState(stateDir) {
  for (const f of [pidFile(stateDir), metaFile(stateDir)]) rmSync(f, { force: true });
}

/** Command line of a live process, or null when the PID is dead.
 *  Lets cmdStop distinguish "stale PID file" from "live foreign process". */
function psCommand(pid, { exec }) {
  const res = exec('ps', ['-p', String(pid), '-o', 'command=']);
  return res.status === 0 ? res.stdout.trim() : null;
}

/** True when `pid` is a live process whose command line is this launcher. */
function isOurLauncher(pid, { exec }) {
  return psCommand(pid, { exec })?.includes('scripts/web.mjs') ?? false;
}

// ── Tailscale serve (tailnet-internal HTTPS; NEVER funnel) ──

// `tailscale serve --bg` does NOT error when the Serve feature is disabled
// on the tailnet — it prints an enable link and blocks waiting for the user
// to visit it. Without a timeout that wedges the launcher forever (silently,
// in detached mode: the hang lives in the child and nothing reaches the log).
// 10s is generous for the normal success path, which returns in well under 1s.
const SERVE_TIMEOUT_MS = 10_000;

export function enableServe({ exec, exists, log, error }) {
  const cli = findTailscaleCli({ exec, exists });
  if (!cli) {
    error('Tailscale CLI not found — install Tailscale or run without --tailscale.');
    error('The server stays up locally at http://localhost:3000.');
    return false;
  }
  const res = exec(cli, ['serve', '--bg', String(PORT)], { timeout: SERVE_TIMEOUT_MS });
  if (res.status !== 0) {
    // stdout holds whatever the CLI printed before the timeout kill —
    // including the login.tailscale.com enable link when Serve is disabled.
    const detail = (res.stderr || res.stdout || '').trim();
    if (res.signal || /not enabled on your tailnet/i.test(detail)) {
      error('tailscale serve is not enabled on your tailnet (the CLI hung waiting for it).');
      if (detail) error(detail);
      error('Enable Serve via the link above, then rerun: npm run web:tailscale');
    } else {
      error(`tailscale serve failed: ${detail}`);
    }
    error('The server stays up locally at http://localhost:3000.');
    return false;
  }
  const url = getTailnetUrl({ exec, exists });
  log(`Tailnet: ${url ?? 'serve enabled (run `tailscale serve status` for the URL)'}`);
  return true;
}

function resetServe({ exec, exists = existsSync, error = console.error }) {
  const cli = findTailscaleCli({ exec, exists });
  if (!cli) return;
  const res = exec(cli, ['serve', 'reset']);
  if (res.status !== 0)
    error('tailscale serve reset failed — run `tailscale serve reset` manually.');
}

// ── Commands ──

export async function cmdStart(opts, deps = {}) {
  const {
    exec = defaultExec,
    spawnImpl = spawn,
    exists = existsSync,
    log = console.log,
    error = console.error,
    stateDir = DEFAULT_STATE_DIR,
    env = process.env,
  } = deps;

  const listener = getListener({ exec });
  if (listener) {
    error(`:${PORT} is already in use by PID ${listener.pid} (${listener.command}).`);
    error('Not starting a second server. `npm run web:status` to inspect it.');
    return 1;
  }

  // Prod always rebuilds; a failed build aborts with nothing left running.
  // The detached child skips the build — the parent already did it.
  if (opts.prod && !env.SUR9E_WEB_SKIP_BUILD) {
    log('Building (next build)…');
    const build = exec(NEXT_BIN, ['build'], {
      cwd: ROOT,
      stdio: 'inherit',
      encoding: undefined,
    });
    if (build.status !== 0) {
      error('next build failed — nothing started.');
      return build.status ?? 1;
    }
  }

  if (opts.detach) return detachSelf(opts, { log, error, stateDir, exec, exists });
  return runForeground(opts, { exec, spawnImpl, exists, log, error, stateDir });
}

function detachSelf(opts, { log, error: _error, stateDir, exec, exists }) {
  mkdirSync(stateDir, { recursive: true });
  const fd = openSync(logFile(stateDir), 'a');
  const args = [fileURLToPath(import.meta.url)];
  if (opts.prod) args.push('--prod');
  // The child re-parses argv, where --tailscale implies prod — forward an
  // explicit --dev so a `--dev --tailscale` start stays dev after re-spawn.
  else if (opts.tailscale) args.push('--dev');
  if (opts.tailscale) args.push('--tailscale');
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, SUR9E_WEB_SKIP_BUILD: '1' },
  });
  writeFileSync(pidFile(stateDir), String(child.pid));
  writeFileSync(
    metaFile(stateDir),
    JSON.stringify(
      {
        pid: child.pid,
        prod: opts.prod,
        tailscale: opts.tailscale,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  child.unref();
  log(
    `Started detached (PID ${child.pid}, mode: ${opts.prod ? 'prod' : 'dev'}${opts.tailscale ? ' + tailscale' : ''}).`,
  );
  log(`Logs:  ${logFile(stateDir)}`);
  log('Local: http://localhost:3000');
  if (opts.tailscale) {
    const url = getTailnetUrl({ exec, exists });
    if (url) log(`Tailnet (once up): ${url}`);
  }
  log('Stop with: npm run web:stop');
  return 0;
}

function runForeground(opts, { exec, spawnImpl, exists, log, error }) {
  // Spawn the local next binary DIRECTLY — an npx intermediary does not
  // reliably forward SIGTERM to its child, so `stop` would orphan the
  // actual server while the port stays bound.
  const args = opts.prod ? ['start', '-p', String(PORT)] : ['dev', '-p', String(PORT)];

  // Tailnet + dev mode: Next blocks cross-origin requests to dev-only
  // assets (/_next/*, HMR websocket), which kills hydration through the
  // tailscale proxy — every button dead, no client-fetched data. Export
  // the tailnet hostname so next.config.ts can list it in
  // allowedDevOrigins. Prod builds don't have the restriction but the
  // env var is harmless there.
  const env = { ...process.env };
  if (opts.tailscale) {
    const url = getTailnetUrl({ exec, exists });
    if (url) env.SUR9E_TAILNET_HOST = new URL(url).hostname;
  }
  const child = spawnImpl(NEXT_BIN, args, { cwd: ROOT, stdio: 'inherit', env });

  let serveEnabled = false;
  if (opts.tailscale) {
    // Wait for the port before publishing — the proxy 502s on a dead target.
    waitForListener({ exec })
      .then(up => {
        if (up) serveEnabled = enableServe({ exec, exists, log, error });
        else error('Server never came up on :3000 — tailscale serve not enabled.');
      })
      .catch(err =>
        error(`tailscale serve setup failed: ${err instanceof Error ? err.message : err}`),
      );
  }

  const shutdown = () => {
    if (serveEnabled) resetServe({ exec, exists, error });
    child.kill('SIGTERM');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', code => {
    if (serveEnabled) resetServe({ exec, exists, error });
    process.exit(code ?? 0);
  });
  return new Promise(() => {}); // lifetime owned by the child's exit handler
}

async function waitForListener({ exec }, timeoutMs = 120_000, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getListener({ exec })) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

export function cmdStatus(deps = {}) {
  const {
    exec = defaultExec,
    exists = existsSync,
    log = console.log,
    stateDir = DEFAULT_STATE_DIR,
  } = deps;
  const listener = getListener({ exec });
  if (!listener) {
    log(`No server listening on :${PORT}.`);
    return 1;
  }
  log(`Listening on :${PORT} — PID ${listener.pid} (${listener.command})`);
  const pid = readPid(stateDir);
  const meta = readMeta(stateDir);
  if (pid && isOurLauncher(pid, { exec })) {
    log(
      `Managed by the sur9e launcher (wrapper PID ${pid}, mode: ${meta?.prod ? 'prod' : 'dev'}${meta?.tailscale ? ' + tailscale' : ''}, started ${meta?.startedAt ?? 'unknown'}).`,
    );
  } else {
    log('Not managed by the sur9e launcher (started elsewhere).');
  }
  log(`Local: http://localhost:${PORT}`);
  if (meta?.tailscale) {
    const url = getTailnetUrl({ exec, exists });
    if (url) log(`Tailnet: ${url}`);
  }
  return 0;
}

/** kill() that swallows ESRCH (pid already gone) so escalation never throws. */
function safeKill(kill, pid, signal) {
  try {
    kill(pid, signal);
  } catch {
    /* process already gone between poll and kill — fine */
  }
}

/** Poll until :3000 is free or `ms` elapses. Returns true once it clears. */
async function waitForPortClear({ exec, pollMs = 250 }, ms) {
  const deadline = Date.now() + ms;
  while (getListener({ exec }) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
  }
  return !getListener({ exec });
}

/** ppid + command of a pid in one ps call, or null when the pid is gone. */
function psPidInfo(pid, { exec }) {
  const res = exec('ps', ['-p', String(pid), '-o', 'ppid=,command=']);
  if (res.status !== 0) return null;
  const m = /^\s*(\d+)\s+(.*)$/.exec(res.stdout.trim());
  return m ? { ppid: Number(m[1]), command: m[2] } : null;
}

/** True when the :3000 listener belongs to THIS checkout — an untracked
 *  foreground `npm run web` (no state file), vs a genuinely foreign app we must
 *  never touch. next renames its listener to "next-server (vX)", so the holder's
 *  own command rarely names the repo; walk the parent chain, where `node
 *  scripts/web.mjs` and this checkout's `next dev` both carry identifying strings. */
function isOwnDevServer(pid, { exec, root }) {
  for (let cur = pid, i = 0; cur > 1 && i < 8; i++) {
    const info = psPidInfo(cur, { exec });
    if (!info) break;
    if (info.command.includes('scripts/web.mjs') || (root && info.command.includes(root))) {
      return true;
    }
    cur = info.ppid;
  }
  return false;
}

/** Process-group id of a pid, or null — lets us kill the whole foreground
 *  tree (launcher + next + build workers) in one shot. */
function processGroup(pid, { exec }) {
  const res = exec('ps', ['-p', String(pid), '-o', 'pgid=']);
  const n = res.status === 0 ? Number(res.stdout.trim()) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function cmdStop(deps = {}) {
  const {
    exec = defaultExec,
    exists = existsSync,
    kill = process.kill,
    log = console.log,
    error = console.error,
    stateDir = DEFAULT_STATE_DIR,
    root = ROOT,
    // Injectable so tests don't wait real seconds. Prod values give a graceful
    // shutdown room before escalating, then a short window for SIGKILL to land.
    termWaitMs = 8_000,
    killWaitMs = 5_000,
    pollMs = 250,
  } = deps;
  const pid = readPid(stateDir);
  const meta = readMeta(stateDir);
  // Three distinct PID-file cases: live launcher (kill), dead process
  // (stale state — just clean up), live foreign process (refuse loudly).
  const cmdline = pid ? psCommand(pid, { exec }) : null;

  let portFree = true; // is :3000 free (or was never ours) when we return?
  let keepState = false; // preserve web.pid so a retry can still target the PID

  if (pid && cmdline?.includes('scripts/web.mjs')) {
    // SIGCONT first: a suspended (Ctrl-Z'd, state "T") tree never acts on
    // SIGTERM until it's resumed — that is how a stopped dev server keeps
    // :3000 bound while shrugging off `web:stop`. Resume, then ask it to exit.
    safeKill(kill, pid, 'SIGCONT');
    safeKill(kill, pid, 'SIGTERM');
    portFree = await waitForPortClear({ exec, pollMs }, termWaitMs);
    if (!portFree) {
      // Graceful stop didn't free the port. Escalate to SIGKILL — and kill
      // whatever still holds :3000 directly, since the `next` child can outlive
      // a SIGKILL'd wrapper (SIGKILL is never forwarded).
      error(`PID ${pid} didn't release :${PORT} on SIGTERM — escalating to SIGKILL.`);
      const held = getListener({ exec });
      safeKill(kill, pid, 'SIGKILL');
      if (held && held.pid !== pid) safeKill(kill, held.pid, 'SIGKILL');
      portFree = await waitForPortClear({ exec, pollMs }, killWaitMs);
    }
    if (portFree) {
      log(`Stopped managed server (PID ${pid}).`);
    } else {
      // Don't claim success and don't drop our state — that is what orphaned
      // the process from the launcher before. Keep the PID for a retry.
      const held = getListener({ exec });
      error(
        `Could not free :${PORT}${held ? ` — PID ${held.pid} still holds it` : ''}. ` +
          `Run: kill -9 ${held?.pid ?? pid}`,
      );
      keepState = true;
    }
  } else if (pid && cmdline === null) {
    log(`Stale state: PID ${pid} is no longer running — cleaning up.`);
  } else if (pid) {
    error(`PID ${pid} from the state file is not a sur9e launcher — not killing it.`);
  } else {
    // No state file. A foreground `npm run web` doesn't track state, so a
    // Ctrl-Z'd dev server lands here. Kill it only if it's identifiably OURS
    // (command line references this checkout); never touch a foreign app.
    const listener = getListener({ exec });
    if (!listener) {
      log('No server running.');
    } else if (isOwnDevServer(listener.pid, { exec, root })) {
      log(`:${PORT} is an untracked sur9e dev server (PID ${listener.pid}) — stopping it.`);
      safeKill(kill, listener.pid, 'SIGCONT'); // resume if Ctrl-Z'd
      const pgid = processGroup(listener.pid, { exec });
      if (pgid) safeKill(kill, -pgid, 'SIGKILL'); // whole foreground tree
      safeKill(kill, listener.pid, 'SIGKILL'); // fallback: the listener itself
      portFree = await waitForPortClear({ exec, pollMs }, killWaitMs);
      if (portFree) log(`Stopped (PID ${listener.pid}).`);
      else error(`Could not free :${PORT} — run: kill -9 ${listener.pid}`);
    } else {
      portFree = false;
      error(
        `:${PORT} is PID ${listener.pid} (${listener.command}) — not a sur9e server; not killing it.\n` +
          `  If you're sure it's yours, run: kill -9 ${listener.pid}`,
      );
    }
  }

  if (meta?.tailscale) resetServe({ exec, exists, error });
  if (!keepState) clearState(stateDir);
  return portFree ? 0 : 1;
}

// ── main ──
// Run only when invoked directly (npm run web), not when imported by tests.
// Same direct-execution guard pattern as batch/screen.mjs.

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseWebArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(2);
  }
  if (opts.command === 'status') process.exit(cmdStatus());
  else if (opts.command === 'stop') process.exit(await cmdStop());
  else process.exit(await cmdStart(opts));
}
