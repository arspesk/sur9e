import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadOutreach } from '../applications';

function makeTmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'load-outreach-test-'));
  mkdirSync(join(root, 'artifacts', 'outreach'), { recursive: true });
  return root;
}

const SAMPLE = `---
offer_num: 1251
company: "Example Talent Partners"
role: "Forward Deployed Engineer"
url: "https://example.com/1251"
drafted: "2026-05-07"
primary: "jordan-rivera"
contacts:
  - id: jordan-rivera
    persona: recruiter
    name: "Jordan Rivera"
    title: "Head of Practice, USA"
    company: "Example Talent Partners (Austin)"
    linkedin: "https://www.linkedin.com/in/jordan-rivera-example/"
    email: "jordan@example.com"
    message_en: |
      Hi Jordan — line one.
      Line two.
    alts_en:
      - "Alt 1"
      - "Alt 2"
pending:
  - persona: hiring_manager
    reason: "End client undisclosed."
sources:
  - "https://example.com/talent/ai/"
---

# Outreach: Example Talent Partners — FDE

Body here.
`;

test('loadOutreach — parses frontmatter + body', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, 'artifacts/outreach/1251-example-talent-2026-05-07.md'), SAMPLE);
  try {
    const r = loadOutreach(root, 'artifacts/outreach/1251-example-talent-2026-05-07.md');
    const fm = r!.frontmatter as Record<string, unknown>;
    expect(fm['offer_num']).toBe(1251);
    expect(fm['primary']).toBe('jordan-rivera');
    expect((fm['contacts'] as unknown[]).length).toBe(1);
    const contact = (fm['contacts'] as Record<string, unknown>[])[0];
    expect(contact['name']).toBe('Jordan Rivera');
    expect((contact['message_en'] as string).trim()).toBe('Hi Jordan — line one.\nLine two.');
    expect((fm['pending'] as unknown[]).length).toBe(1);
    expect((fm['sources'] as unknown[]).length).toBe(1);
    expect(r!.body).toMatch(/^# Outreach/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadOutreach — returns null when file missing', () => {
  const root = makeTmpRoot();
  try {
    expect(loadOutreach(root, 'artifacts/outreach/missing.md')).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadOutreach — returns null when no frontmatter delimiter', () => {
  const root = makeTmpRoot();
  writeFileSync(join(root, 'artifacts/outreach/no-front.md'), '# Plain markdown\nNo YAML.\n');
  try {
    expect(loadOutreach(root, 'artifacts/outreach/no-front.md')).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadOutreach — handles missing optional fields', () => {
  const root = makeTmpRoot();
  const minimal = `---
offer_num: 999
contacts: []
pending: []
sources: []
---

Body.
`;
  writeFileSync(join(root, 'artifacts/outreach/999-x-2026-05-07.md'), minimal);
  try {
    const r = loadOutreach(root, 'artifacts/outreach/999-x-2026-05-07.md');
    const fm = r!.frontmatter as Record<string, unknown>;
    expect(fm['offer_num']).toBe(999);
    expect((fm['contacts'] as unknown[]).length).toBe(0);
    expect(fm['primary']).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
