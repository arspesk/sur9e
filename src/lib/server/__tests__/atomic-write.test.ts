// src/lib/server/__tests__/atomic-write.test.ts
//
// Unit test for the atomicWrite data-integrity primitive. atomicWrite writes
// to a unique .tmp file, renames the existing target to .bak (if present), then
// renames .tmp into place — so a crash never leaves the canonical file
// half-written. These tests pin that contract: content lands, the temp file is
// cleaned up, overwrites preserve the prior version as .bak, parent dirs are
// created, and a write into a path that can't be renamed leaves the original
// untouched (no partial file).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWrite } from '../atomic-write';

describe('atomicWrite', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'atomic-write-test-'));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('writes content that lands and is readable', () => {
    const target = join(root, 'note.md');
    atomicWrite(target, 'hello world');

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('hello world');
  });

  it('writes UTF-8 content faithfully (multibyte round-trips)', () => {
    const target = join(root, 'unicode.md');
    const content = 'café — naïve — 日本語 — 🚀';
    atomicWrite(target, content);

    expect(readFileSync(target, 'utf-8')).toBe(content);
  });

  it('leaves no leftover .tmp files after a successful write', () => {
    const target = join(root, 'clean.md');
    atomicWrite(target, 'content');

    const leftovers = readdirSync(root).filter(name => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('overwrites an existing file with new content', () => {
    const target = join(root, 'overwrite.md');
    writeFileSync(target, 'original', 'utf-8');

    atomicWrite(target, 'replacement');

    expect(readFileSync(target, 'utf-8')).toBe('replacement');
  });

  it('preserves the previous content as a .bak sibling on overwrite', () => {
    const target = join(root, 'backup.md');
    const bak = `${target}.bak`;
    writeFileSync(target, 'previous good content', 'utf-8');

    atomicWrite(target, 'new content');

    // Target holds the new content...
    expect(readFileSync(target, 'utf-8')).toBe('new content');
    // ...and the prior version survives as .bak for recovery.
    expect(existsSync(bak)).toBe(true);
    expect(readFileSync(bak, 'utf-8')).toBe('previous good content');
  });

  it('does not create a .bak when the target did not previously exist', () => {
    const target = join(root, 'fresh.md');
    const bak = `${target}.bak`;

    atomicWrite(target, 'first write');

    expect(existsSync(target)).toBe(true);
    expect(existsSync(bak)).toBe(false);
  });

  it('creates missing parent directories idempotently', () => {
    const target = join(root, 'nested', 'deep', 'file.md');

    atomicWrite(target, 'in a deep dir');

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('in a deep dir');
  });

  it('writes an empty string as a zero-length file', () => {
    const target = join(root, 'empty.md');
    atomicWrite(target, '');

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('');
  });

  it('leaves the original file intact when the backup rename fails', () => {
    // Failure injection: pre-create the .bak path as a NON-EMPTY directory.
    // The original target exists, so atomicWrite tries renameSync(target ->
    // bak), which fails because you cannot rename a file over a non-empty
    // directory. The throw must happen BEFORE the canonical file is replaced,
    // so the original good content survives untouched (no partial write).
    const target = join(root, 'doc.md');
    const bak = `${target}.bak`;
    writeFileSync(target, 'previous good content', 'utf-8');
    // Make the .bak path an un-renamable-over (non-empty) directory.
    mkdirSync(bak);
    writeFileSync(join(bak, 'block.txt'), 'occupied', 'utf-8');

    expect(() => atomicWrite(target, 'should never land')).toThrow();

    // The integrity guarantee that matters: the canonical file survives with
    // its prior content fully intact — the failure happened before any write
    // touched the real path, so there is no partial / corrupt canonical file.
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('previous good content');

    // Documented limitation: atomicWrite does NOT clean up its staged .tmp
    // file when a later step throws. The orphaned .tmp is inert (it is never
    // the canonical path), but pinning it here makes the behavior explicit so
    // a future "swallow the error" refactor can't silently change it.
    const leftovers = readdirSync(root).filter(name => name.endsWith('.tmp'));
    expect(leftovers).toHaveLength(1);
  });
});
