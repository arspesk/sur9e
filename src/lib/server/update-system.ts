import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '@/lib/root';

// update-system.mjs is a standalone CLI we shell out to — apply/rollback must
// run in a separate process from the server they may restart, so we spawn
// rather than import.
//
// The script name is assembled at runtime (`['update-system', 'mjs'].join('.')`
// instead of the literal 'update-system.mjs') on purpose: Turbopack's
// child_process tracer treats a static `.mjs` string arg to `node` as a module
// to bundle and emits "Module not found: Can't resolve" build warnings for it.
// The array-join is opaque to its static evaluator, so it stops trying — the
// file is never bundled (it is run at runtime), so this changes nothing but the
// warning. A literal, a string concat, or a `turbopackIgnore` comment do NOT
// work here (all verified against `next build`).
const updateScriptPath = () => join(ROOT, ['update-system', 'mjs'].join('.'));

export function runUpdateSystem(cmd: 'check' | 'apply' | 'rollback', timeoutMs: number): string {
  return execFileSync('node', [updateScriptPath(), cmd], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
}
