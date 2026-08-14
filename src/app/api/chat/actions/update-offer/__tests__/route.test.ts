// src/app/api/chat/actions/update-offer/__tests__/route.test.ts
//
// POST /api/chat/actions/update-offer — the confirm-gated offer update route.
// Handles structured metadata fields and/or body find/replace edits behind a
// single confirmation card. Web context parks the card; terminal context applies
// directly when terminalApproved. Fail-fast validations (no report, unknown/protected
// fields, ambiguous body matches) return 400 so a doomed card is never shown.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock ROOT before importing the route.
let testRoot = '';
vi.mock('@/lib/root', () => ({
  get ROOT() {
    return testRoot;
  },
}));

// revalidatePath hits Next internals — stub it.
vi.mock('@/server/revalidate', () => ({ revalidatePath: vi.fn() }));

import { POST } from '../route';

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | Posted |
|---|------|---------|------|-------|--------|-----|--------|-------|--------|
| 42 | 2026-08-01 | Acme | Platform Engineer | 3.8/5 | Evaluated | ❌ | [42](artifacts/reports/042-acme-2026-08-01.md) | - |  |
`;

const REPORT = `---
num: 42
company: Acme
role: Platform Engineer
date: '2026-08-01'
status: Evaluated
state: evaluated
score: 3.8
archetype: Platform
tldr: Solid platform role.
---

## Summary

Acme builds infrastructure. The role is hands-on. Based on the comp and the growth trajectory, this is attractive.

## Verdict

Worth applying.
`;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'update-offer-route-'));
  mkdirSync(join(testRoot, 'data'), { recursive: true });
  mkdirSync(join(testRoot, 'artifacts/reports'), { recursive: true });
  writeFileSync(join(testRoot, 'data/applications.md'), TRACKER);
  writeFileSync(join(testRoot, 'artifacts/reports/042-acme-2026-08-01.md'), REPORT);
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/chat/actions/update-offer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat/actions/update-offer', () => {
  it('web-chat context: a valid fields update parks a confirm card and returns a token', async () => {
    const res = await POST(
      req({ num: 42, fields: { url: 'https://acme.dev/jobs/1' } }, { 'x-sur9e-turn': 'turn-1' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsConfirm).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.summary).toContain('Update');
    expect(body.meta).toBeDefined();
    // The card is parked — nothing is written yet.
    const report = readFileSync(join(testRoot, 'artifacts/reports/042-acme-2026-08-01.md'), 'utf8');
    expect(report).toBe(REPORT);
  });

  it('returns 400 when no report exists for the offer', async () => {
    const res = await POST(
      req({ num: 99, fields: { url: 'https://example.com' } }, { 'x-sur9e-turn': 'turn-1' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('99');
  });

  it('returns 400 when a body edit oldText is not found', async () => {
    const res = await POST(
      req(
        {
          num: 42,
          bodyEdits: [{ oldText: 'not present anywhere', newText: 'replacement' }],
        },
        { 'x-sur9e-turn': 'turn-1' },
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('not found');
  });

  it('returns 400 when a body edit oldText is ambiguous', async () => {
    const res = await POST(
      req(
        {
          num: 42,
          bodyEdits: [{ oldText: 'the', newText: 'a' }],
        },
        { 'x-sur9e-turn': 'turn-1' },
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('matches 2 places');
  });

  it('returns 400 for a protected field (status)', async () => {
    const res = await POST(
      req({ num: 42, fields: { status: 'applied' } }, { 'x-sur9e-turn': 'turn-1' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('set_status');
  });

  it('returns 400 for an unknown field', async () => {
    const res = await POST(
      req({ num: 42, fields: { vibe: 'good' } }, { 'x-sur9e-turn': 'turn-1' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('vibe');
  });

  it('terminal context with terminalApproved applies the update directly', async () => {
    const res = await POST(
      req({
        num: 42,
        fields: { url: 'https://acme.dev/jobs/1' },
        terminalApproved: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(true);
    expect(body.offerUpdate).toBeDefined();
    // Verify the report frontmatter was actually changed.
    const after = readFileSync(join(testRoot, 'artifacts/reports/042-acme-2026-08-01.md'), 'utf8');
    expect(after).toContain('url: https://acme.dev/jobs/1');
  });

  it('terminal context without approval only previews (no write)', async () => {
    const res = await POST(
      req({
        num: 42,
        fields: { url: 'https://acme.dev/jobs/1' },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).needsConfirm).toBe(true);
    // Verify nothing was written.
    const report = readFileSync(join(testRoot, 'artifacts/reports/042-acme-2026-08-01.md'), 'utf8');
    expect(report).toBe(REPORT);
    expect(report).not.toContain('acme.dev/jobs/1');
  });
});
