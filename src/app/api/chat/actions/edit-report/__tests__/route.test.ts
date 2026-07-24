// src/app/api/chat/actions/edit-report/__tests__/route.test.ts
//
// POST /api/chat/actions/edit-report — the confirm-gated report edit route.
// Web-chat context (x-sur9e-turn header) parks a confirm card; terminal context
// applies directly when terminalApproved. Fail-fast validations (no report,
// missing/ambiguous text) return 400 so a doomed card is never shown.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// revalidatePath hits Next internals — stub it (asserted separately in the
// confirm-resolve route wiring; here we only need it not to throw).
vi.mock('@/server/revalidate', () => ({ revalidatePath: vi.fn() }));

// reportPathForNum is the only reports export we redirect at a temp file; the
// edit/parse/save helpers stay real so the route exercises the true write path.
const holder: { path: string | null } = { path: null };
vi.mock('@/lib/server/reports', async importActual => {
  const actual = await importActual<typeof import('@/lib/server/reports')>();
  return { ...actual, reportPathForNum: () => holder.path };
});

import { POST } from '../route';

const REPORT = [
  '---',
  'num: 7',
  'company: "Acme"',
  'role: "Staff Engineer"',
  'date: "2026-07-01"',
  'status: "Evaluated"',
  'state: "evaluated"',
  'score: 4.1',
  '---',
  '',
  '# Evaluation',
  '',
  'The comp band looks below market.',
  '',
  'The comp band note repeats twice here.',
  '',
].join('\n');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sur9e-edit-route-'));
  holder.path = null;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeReport(): string {
  const filePath = join(dir, '007-acme-2026-07-01.md');
  writeFileSync(filePath, REPORT, 'utf8');
  return filePath;
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/chat/actions/edit-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat/actions/edit-report', () => {
  it('web-chat context: a valid edit parks a confirm card and returns a token', async () => {
    holder.path = writeReport();
    const res = await POST(
      req(
        { num: 7, oldText: 'The comp band looks below market.', newText: 'Comp is competitive.' },
        { 'x-sur9e-turn': 'turn-1' },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsConfirm).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.summary).toBe('Edit report #7');
    expect(body.meta).toContain('report write');
    // The card is parked — nothing is written yet.
    expect(readFileSync(holder.path, 'utf8')).toBe(REPORT);
  });

  it('returns 400 when no report exists for the offer', async () => {
    holder.path = null;
    const res = await POST(
      req({ num: 99, oldText: 'x', newText: 'y' }, { 'x-sur9e-turn': 'turn-1' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no report for offer #99');
  });

  it('returns 400 when old_text is not found', async () => {
    holder.path = writeReport();
    const res = await POST(
      req({ num: 7, oldText: 'not present anywhere', newText: 'y' }, { 'x-sur9e-turn': 'turn-1' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('text to replace not found in report #7');
  });

  it('returns 400 when old_text is ambiguous', async () => {
    holder.path = writeReport();
    const res = await POST(
      req({ num: 7, oldText: 'The comp band', newText: 'y' }, { 'x-sur9e-turn': 'turn-1' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/old_text matches 2 places/);
  });

  it('terminal context with terminalApproved applies the edit directly', async () => {
    holder.path = writeReport();
    const res = await POST(
      req({
        num: 7,
        oldText: 'The comp band looks below market.',
        newText: 'Comp is competitive.',
        terminalApproved: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.edited).toBe(true);
    expect(body.report).toEqual({ num: 7 });
    const after = readFileSync(holder.path, 'utf8');
    expect(after).toContain('Comp is competitive.');
    expect(after).not.toContain('below market');
  });

  it('terminal context without approval only previews (no write)', async () => {
    holder.path = writeReport();
    const res = await POST(
      req({
        num: 7,
        oldText: 'The comp band looks below market.',
        newText: 'Comp is competitive.',
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).needsConfirm).toBe(true);
    expect(readFileSync(holder.path, 'utf8')).toBe(REPORT);
  });
});
