import { readFileSync, statSync } from 'node:fs';

/**
 * Read a file as UTF-8; return null if it doesn't exist.
 *
 * Replaces the `if (!existsSync(p)) return null; readFileSync(p)` pattern
 * (a classic TOCTOU race — the file can disappear between the check and
 * the read). Operates directly and catches ENOENT instead, which halves
 * the syscall count and removes the race window.
 */
export function readFileOrNull(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Same shape for stat — useful for mtime-based caches. */
export function statOrNull(filePath: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
