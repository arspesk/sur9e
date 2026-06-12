// test/modes/portability.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModeManifest } from '../../src/lib/server/modes';

const ROOT = resolve(__dirname, '../..');
const MODES_DIR = join(ROOT, 'content/modes');

// Claude-only tool references the engineer must NOT leave in mode bodies.
const CLAUDE_ISMS = [
  /\bWebFetch\b/,
  /\bWebSearch\b/,
  /\bUse the Read tool\b/i,
  /\bUse the Edit tool\b/i,
  /\bUse the Write tool\b/i,
  /\bUse Bash\b/i,
];

describe('mode-prompt portability', () => {
  it('every mode parses front-matter', () => {
    const manifest = loadModeManifest(ROOT);
    expect(Object.keys(manifest).length).toBeGreaterThanOrEqual(17);
  });

  it.each(
    readdirSync(MODES_DIR).filter(n => n.endsWith('.md')),
  )('%s — body contains no Claude-isms', filename => {
    const path = join(MODES_DIR, filename);
    const text = readFileSync(path, 'utf-8');
    // _shared.md intentionally NAMES the Claude tools in the meta-guidance
    // sentence that tells mode authors NOT to use them. Strip that sentence
    // before linting so the file doesn't trip its own rule. The carve-out is
    // anchored to a substring unique to _shared.md so it doesn't accidentally
    // mask Claude-isms in real mode bodies.
    const cleaned = text.replace(/Do \*\*not\*\* name Claude-specific tools[^\n]*/g, '');
    for (const re of CLAUDE_ISMS) {
      expect(cleaned).not.toMatch(re);
    }
  });
});
