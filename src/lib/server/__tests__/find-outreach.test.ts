import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { findOutreach } from '../applications';

function makeTmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'outreach-test-'));
  mkdirSync(join(root, 'artifacts', 'outreach'), { recursive: true });
  return root;
}

test('findOutreach — returns null when artifacts/outreach/ is empty', () => {
  const root = makeTmpRoot();
  try {
    expect(findOutreach(root, 1251)).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findOutreach — picks single match by num prefix', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, 'artifacts/outreach/1251-franklin-fitch-2026-05-07.md'), '');
  try {
    expect(findOutreach(root, 1251)).toBe('artifacts/outreach/1251-franklin-fitch-2026-05-07.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findOutreach — picks newest by date suffix', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, 'artifacts/outreach/1251-franklin-fitch-2026-04-01.md'), '');
  writeFileSync(join(root, 'artifacts/outreach/1251-franklin-fitch-2026-05-07.md'), '');
  writeFileSync(join(root, 'artifacts/outreach/1251-franklin-fitch-2026-04-15.md'), '');
  try {
    expect(findOutreach(root, 1251)).toBe('artifacts/outreach/1251-franklin-fitch-2026-05-07.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findOutreach — num prefix is exact (no num bleed)', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, 'artifacts/outreach/12510-some-co-2026-05-07.md'), '');
  try {
    // 1251 must NOT match 12510-…
    expect(findOutreach(root, 1251)).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findOutreach — missing artifacts/outreach/ dir returns null', () => {
  const root = mkdtempSync(join(tmpdir(), 'outreach-test-'));
  try {
    expect(findOutreach(root, 1251)).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
