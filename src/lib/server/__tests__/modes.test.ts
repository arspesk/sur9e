// src/lib/server/__tests__/modes.test.ts
//
// Tests for loadModeManifest: front-matter parsing, default-application
// when the YAML block is missing, and exclusion of `_`-prefixed includes
// (`_shared.md`, future `_smoke.md`). Each test allocates a fresh tmpdir
// so the per-process cache (keyed on rootPath) does not cross-contaminate.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModeManifest } from '../modes';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-modes-'));
  mkdirSync(join(root, 'content/modes'), { recursive: true });
  writeFileSync(
    join(root, 'content/modes/interview-prep.md'),
    `---
exec: both
default_platform: opencode
default_model: anthropic/claude-3-haiku
needs_tools: [shell, web_search]
---
Body text here.`,
  );
  writeFileSync(join(root, 'content/modes/screen.md'), `Body without front-matter.`);
  writeFileSync(
    join(root, 'content/modes/_shared.md'),
    `Shared prelude — should NOT appear in the manifest.`,
  );
  return root;
}

describe('loadModeManifest', () => {
  it('parses YAML front-matter and produces ModeMeta', () => {
    const manifest = loadModeManifest(fixture());
    expect(Object.keys(manifest).sort()).toEqual(['interview-prep', 'screen']);
    expect(manifest['interview-prep'].exec).toBe('both');
    expect(manifest['interview-prep'].default_platform).toBe('opencode');
    expect(manifest['interview-prep'].body).toContain('Body text here.');
  });

  it('applies defaults when front-matter is missing', () => {
    const manifest = loadModeManifest(fixture());
    expect(manifest.screen.exec).toBe('interactive');
    expect(manifest.screen.default_platform).toBe('claude');
    expect(manifest.screen.body).toContain('Body without front-matter.');
  });

  it('excludes _shared.md from the manifest', () => {
    const manifest = loadModeManifest(fixture());
    expect(manifest._shared).toBeUndefined();
  });

  it('every real content/modes/*.md parses against ModeFrontMatter', () => {
    // Worktree-aware: this test file lives at <repo>/src/lib/server/__tests__/modes.test.ts
    // — back up 4 dirs to get the repo root.
    const repoRoot = resolve(__dirname, '../../../..');
    const manifest = loadModeManifest(repoRoot);
    // 17 user-facing modes per the per-mode table.
    expect(Object.keys(manifest).length).toBeGreaterThanOrEqual(17);
    for (const m of Object.values(manifest)) {
      expect(['headless', 'interactive', 'both']).toContain(m.exec);
      expect(['claude', 'codex', 'opencode']).toContain(m.default_platform);
      expect(m.default_model.length).toBeGreaterThan(0);
    }
  });
});
