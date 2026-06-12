import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { findArtifact } from '../applications';

const CAND = 'arsenii-peskovatskov';

function makeTmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'artifacts-test-'));
  mkdirSync(join(root, 'artifacts', 'output'), { recursive: true });
  return root;
}

test('findArtifact — returns null when artifacts/output/ is empty', () => {
  const root = makeTmpRoot();
  try {
    expect(findArtifact(root, 'cv', CAND, 'pinterest')).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — picks single match', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-pinterest-2026-05-03.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', CAND, 'pinterest')).toBe(
      `artifacts/output/cv-${CAND}-pinterest-2026-05-03.pdf`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — picks newest by date suffix', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-pinterest-2026-04-01.pdf`), '');
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-pinterest-2026-05-03.pdf`), '');
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-pinterest-2026-04-15.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', CAND, 'pinterest')).toBe(
      `artifacts/output/cv-${CAND}-pinterest-2026-05-03.pdf`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — slug as suffix of company slug must NOT match', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-grey-matter-2026-05-03.pdf`), '');
  try {
    // 'matter' must not match the Grey Matter file.
    expect(findArtifact(root, 'cv', CAND, 'matter')).toBe(null);
    // 'grey-matter' must match it correctly.
    expect(findArtifact(root, 'cv', CAND, 'grey-matter')).toBe(
      `artifacts/output/cv-${CAND}-grey-matter-2026-05-03.pdf`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — slug as prefix of another slug must NOT match', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-pinterest-labs-2026-05-03.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', CAND, 'pinterest')).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — disambiguates similar slugs in same dir', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-grey-matter-2026-05-03.pdf`), '');
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-matter-2026-05-04.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', CAND, 'matter')).toBe(
      `artifacts/output/cv-${CAND}-matter-2026-05-04.pdf`,
    );
    expect(findArtifact(root, 'cv', CAND, 'grey-matter')).toBe(
      `artifacts/output/cv-${CAND}-grey-matter-2026-05-03.pdf`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — cover-letter prefix is independent of cv prefix', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-pinterest-2026-05-03.pdf`), '');
  writeFileSync(join(root, `artifacts/output/cover-letter-${CAND}-pinterest-2026-05-03.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', CAND, 'pinterest')).toBe(
      `artifacts/output/cv-${CAND}-pinterest-2026-05-03.pdf`,
    );
    expect(findArtifact(root, 'cover-letter', CAND, 'pinterest')).toBe(
      `artifacts/output/cover-letter-${CAND}-pinterest-2026-05-03.pdf`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — missing artifacts/output/ dir returns null (no throw)', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifacts-test-'));
  try {
    expect(findArtifact(root, 'cv', CAND, 'pinterest')).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — empty candidate returns null', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-pinterest-2026-05-03.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', '', 'pinterest')).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — empty slug returns null', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-pinterest-2026-05-03.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', CAND, '')).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — num-exact match wins over other nums and legacy files', () => {
  const root = makeTmpRoot();
  // Two same-company offers on the same day + one legacy num-less file.
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-stripe-54-2026-06-06.pdf`), '');
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-stripe-292-2026-06-06.pdf`), '');
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-stripe-2026-06-07.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', CAND, 'stripe', 54)).toBe(
      `artifacts/output/cv-${CAND}-stripe-54-2026-06-06.pdf`,
    );
    expect(findArtifact(root, 'cv', CAND, 'stripe', 292)).toBe(
      `artifacts/output/cv-${CAND}-stripe-292-2026-06-06.pdf`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — falls back to newest legacy file when the num has no match', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-stripe-2026-06-01.pdf`), '');
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-stripe-2026-06-05.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', CAND, 'stripe', 54)).toBe(
      `artifacts/output/cv-${CAND}-stripe-2026-06-05.pdf`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findArtifact — numbered files do not leak into num-less queries as dates', () => {
  const root = makeTmpRoot();
  // Only a numbered file exists; a query without num must not mis-parse
  // "54-2026-06-06" as a date suffix.
  writeFileSync(join(root, `artifacts/output/cv-${CAND}-stripe-54-2026-06-06.pdf`), '');
  try {
    expect(findArtifact(root, 'cv', CAND, 'stripe')).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
