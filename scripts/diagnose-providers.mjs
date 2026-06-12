#!/usr/bin/env node
// scripts/diagnose-providers.mjs
// SPDX-License-Identifier: MIT
// Why does the setup wizard see a CLI as (not) installed? Run it the SAME way
// the wizard runs (under npm) so the PATH/env matches exactly:
//
//   npm run diagnose
//
// or capture to a file and share it:
//
//   npm run diagnose > diag.txt 2>&1
//
// Prints: env + PATH, a direct `<cli> --version` probe with timing + error
// codes, a `which` lookup, and the wizard's own nested provider probe.

import { execFileSync } from 'node:child_process';

const CLIS = ['claude', 'codex', 'opencode'];

function section(title) {
  console.log(`\n===== ${title} =====`);
}

section('environment');
console.log('node     ', process.version, `${process.platform}/${process.arch}`);
console.log('cwd      ', process.cwd());
console.log(
  'npm ctx  ',
  process.env.npm_lifecycle_event
    ? `yes (${process.env.npm_lifecycle_event})`
    : 'no (run via `npm run diagnose`)',
);
console.log('PATH entries:');
for (const p of (process.env.PATH || '').split(':')) {
  console.log('  ', p);
}

section('direct `<cli> --version` probe (this is what checkInstalled does)');
for (const bin of CLIS) {
  const start = process.hrtime.bigint();
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf-8', timeout: 15000 });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `${bin.padEnd(9)} OK   ${ms.toFixed(0).padStart(6)}ms  ->  ${out.trim().split('\n')[0]}`,
    );
  } catch (err) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `${bin.padEnd(9)} FAIL ${ms.toFixed(0).padStart(6)}ms  ->  code=${err.code} signal=${err.signal} :: ${(err.message || '').split('\n')[0]}`,
    );
  }
}

section('`which <cli>` lookup');
for (const bin of CLIS) {
  try {
    const p = execFileSync('which', [bin], { encoding: 'utf-8', timeout: 5000 }).trim();
    console.log(`${bin.padEnd(9)} ${p}`);
  } catch {
    console.log(`${bin.padEnd(9)} (not found on PATH)`);
  }
}

section('wizard nested probe (node -> npx tsx providers-probe.mjs)');
try {
  const out = execFileSync(
    'npx',
    ['tsx', '--conditions=react-server', 'scripts/providers-probe.mjs'],
    { encoding: 'utf-8', timeout: 60000 },
  );
  const j = JSON.parse(out);
  for (const k of Object.keys(j)) {
    console.log(
      `${k.padEnd(9)} installed=${JSON.stringify(j[k].installed)}  authed=${JSON.stringify(j[k].authed)}`,
    );
  }
} catch (err) {
  console.log('probe failed:', (err.message || '').split('\n').slice(0, 4).join(' | '));
}

console.log('');
