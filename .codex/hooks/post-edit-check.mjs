#!/usr/bin/env node
// PostToolUse hook — runs Biome (lint+format check) or Prettier (--check) on
// the touched file and surfaces errors back to Claude as additionalContext.
//
// Dispatch by extension:
//   .mjs/.cjs/.js/.json/.jsonc/.css → Biome (`biome check <file>`)
//   .md/.yml/.yaml                  → Prettier (`prettier --check <file>`)
//   anything else                   → no-op
//
// Why per-file check and NOT per-file tsc:
//   - Biome on one file: <100ms, scoped, gives clean immediate feedback.
//   - tsc --checkJs is project-wide by design (cross-file types) and runs
//     in 2–5s on this codebase; running it on every Edit/Write blocks Claude.
//     Type-check stays in the pre-commit + CI gates instead.
//
// Bypass: set CLAUDE_SKIP_HOOK=1 in env (e.g. for bulk edits).

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HOOK_DIR, '..', '..');

if (process.env.CLAUDE_SKIP_HOOK === '1') process.exit(0);

// Read JSON from stdin (Claude Code hook contract).
let raw = '';
try {
  raw = await new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      buf += chunk;
    });
    process.stdin.on('end', () => resolve(buf));
    setTimeout(() => resolve(buf), 200);
  });
} catch {
  /* no stdin — exit silently */
}

if (!raw.trim()) process.exit(0);

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path;
if (!filePath || typeof filePath !== 'string') process.exit(0);

const rel = relative(ROOT, filePath);
if (rel.startsWith('..') || rel.startsWith('node_modules')) process.exit(0);

// Pick the tool by extension.
const biomeExt = /\.(mjs|cjs|js|json|jsonc|css)$/i;
const prettierExt = /\.(md|yml|yaml)$/i;

const biomeBin = join(ROOT, 'node_modules/@biomejs/biome/bin/biome');
const prettierBin = join(ROOT, 'node_modules/prettier/bin/prettier.cjs');

let toolLabel = '';
let bin = '';
let args = [];

if (biomeExt.test(filePath)) {
  if (!existsSync(biomeBin)) process.exit(0);
  toolLabel = 'Biome';
  bin = biomeBin;
  args = ['check', '--no-errors-on-unmatched', filePath];
} else if (prettierExt.test(filePath)) {
  if (!existsSync(prettierBin)) process.exit(0);
  toolLabel = 'Prettier';
  bin = prettierBin;
  args = ['--check', filePath];
} else {
  process.exit(0);
}

let output = '';
try {
  execFileSync('node', [bin, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  output = (err.stdout || '') + (err.stderr || '');
}

if (!output.trim()) process.exit(0);

const out = {
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: `${toolLabel} reported issues in ${rel}:\n\n${output.trim()}\n\nFix before continuing or set CLAUDE_SKIP_HOOK=1 to bypass.`,
  },
};
process.stdout.write(JSON.stringify(out));
