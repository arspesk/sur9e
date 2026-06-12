// src/lib/server/atomic-write.ts
//
// Converted from atomic-write.mjs. Existing .mjs callers (applications.mjs,
// usage-tracker.mjs) continue importing the .mjs sibling until Tasks 4 + 6.

import 'server-only';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Atomically write content to filePath.
 * Strategy: write to a unique .tmp file (random suffix prevents
 * concurrent-write races), rename original to .bak (if exists),
 * rename .tmp to original.
 * If anything fails, the .bak retains the previous good content.
 *
 * TODO(concurrency): Within a single Node.js process, multiple server actions
 * racing on the same file can cause a read-modify-write hazard (e.g., two
 * concurrent status updates each reading the file before either writes back).
 * Because this function is entirely synchronous, adding a lock here would not
 * help — the race window lives in the callers across their `await` points, not
 * inside this function. A proper fix requires either (a) converting all
 * callers to an async queue-per-path pattern, or (b) serialising mutations at
 * the server-action layer. Cross-process races (CLI vs. server) are out of
 * scope for an in-process solution regardless.
 */
export function atomicWrite(filePath: string, content: string): void {
  const suffix = randomBytes(4).toString('hex');
  const tmpPath = `${filePath}.${suffix}.tmp`;
  const bakPath = `${filePath}.bak`;
  // Idempotently ensure the parent directory exists. Hardens fresh installs
  // and worktrees where inputs/personalization/ may not yet be populated.
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmpPath, content, 'utf-8');
  if (existsSync(filePath)) {
    renameSync(filePath, bakPath);
  }
  renameSync(tmpPath, filePath);
}
