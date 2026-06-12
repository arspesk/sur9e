import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadReport } from '@/lib/server/reports';

// Regression: loadReport must reject malformed filenames (path traversal AND
// NUL bytes) via the same "Invalid filename" branch, and must never leak the
// absolute on-disk path in any error envelope (info disclosure).
describe('loadReport filename guard + path non-disclosure', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-report-guard-'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a NUL byte in the filename without crashing (no 500 / no path leak)', () => {
    const r = loadReport(root, '005-acme-2026-06-05.md\0.bak') as {
      error?: string;
      path?: string | null;
    };
    expect(r.error).toBe('Invalid filename');
    expect(r.path).toBeNull();
  });

  it('rejects path-traversal filenames', () => {
    for (const bad of ['../secret.md', 'a/b.md', 'a\\b.md']) {
      const r = loadReport(root, bad) as { error?: string; path?: string | null };
      expect(r.error).toBe('Invalid filename');
      expect(r.path).toBeNull();
    }
  });

  it('returns a not-found error with no absolute path for a missing report', () => {
    const r = loadReport(root, 'does-not-exist.md') as {
      error?: string;
      path?: string | null;
    };
    expect(r.error).toBe('Report not found');
    // The absolute on-disk path must never reach callers.
    expect(r.path).toBeNull();
  });
});
