// src/app/api/modes/__tests__/route.test.ts
//
// Integration test for GET /api/modes. Mocks loadModeManifest so the
// route never touches the real content/modes/ tree — we only verify the
// shape contract: `screen` pinned first, manifest entries sorted, no
// `body` field leaks into the response. (`screen` comes from the
// manifest like every other mode since content/modes/screen.md gained
// front-matter in the multi-provider merge — no synthetic entry.)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModeMeta } from '@/lib/schemas/modes';

const manifestHolder: { current: Record<string, ModeMeta> } = { current: {} };

vi.mock('@/lib/server/modes', () => ({
  loadModeManifest: () => manifestHolder.current,
}));

function fakeMode(modeId: string, overrides?: Partial<ModeMeta>): ModeMeta {
  return {
    modeId,
    exec: 'interactive',
    default_platform: 'claude',
    default_model: 'claude-sonnet-4-6',
    needs_tools: [],
    body: '# fake body — should never appear in the response',
    ...overrides,
  };
}

beforeEach(() => {
  manifestHolder.current = {};
});

describe('GET /api/modes', () => {
  it('pins the `screen` mode as the first row', async () => {
    manifestHolder.current = {
      apply: fakeMode('apply'),
      screen: fakeMode('screen', {
        exec: 'headless',
        default_model: 'claude-haiku-4-5-20251001',
      }),
    };
    const { GET } = await import('../route');
    const res = GET();
    const body = (await res.json()) as { modes: Array<{ modeId: string }> };
    expect(body.modes[0]?.modeId).toBe('screen');
  });

  it('sorts manifest entries alphabetically after the pinned screen row', async () => {
    manifestHolder.current = {
      training: fakeMode('training'),
      apply: fakeMode('apply'),
      screen: fakeMode('screen', { exec: 'headless' }),
      contact: fakeMode('contact'),
    };
    const { GET } = await import('../route');
    const res = GET();
    const body = (await res.json()) as { modes: Array<{ modeId: string }> };
    // First is screen, then alphabetical.
    expect(body.modes.map(m => m.modeId)).toEqual(['screen', 'apply', 'contact', 'training']);
  });

  it('strips the `body` field — clients only need metadata', async () => {
    manifestHolder.current = {
      apply: fakeMode('apply'),
    };
    const { GET } = await import('../route');
    const res = GET();
    const body = (await res.json()) as { modes: Array<Record<string, unknown>> };
    for (const m of body.modes) {
      expect(m).not.toHaveProperty('body');
    }
  });

  it('returns the front-matter fields the override table renders', async () => {
    manifestHolder.current = {
      evaluate: fakeMode('evaluate', {
        exec: 'headless',
        default_platform: 'codex',
        default_model: 'gpt-5.5',
        needs_tools: ['shell'],
      }),
    };
    const { GET } = await import('../route');
    const res = GET();
    const body = (await res.json()) as {
      modes: Array<{
        modeId: string;
        exec: string;
        default_platform: string;
        default_model: string;
        needs_tools: string[];
      }>;
    };
    const evaluate = body.modes.find(m => m.modeId === 'evaluate');
    expect(evaluate).toBeDefined();
    expect(evaluate?.exec).toBe('headless');
    expect(evaluate?.default_platform).toBe('codex');
    expect(evaluate?.default_model).toBe('gpt-5.5');
    expect(evaluate?.needs_tools).toEqual(['shell']);
  });

  it('serves screen from the manifest entry (front-matter, not a synthetic row)', async () => {
    manifestHolder.current = {
      screen: fakeMode('screen', {
        exec: 'headless',
        default_model: 'claude-haiku-4-5-20251001',
      }),
    };
    const { GET } = await import('../route');
    const res = GET();
    const body = (await res.json()) as {
      modes: Array<{
        modeId: string;
        exec: string;
        default_platform: string;
        default_model: string;
      }>;
    };
    expect(body.modes).toHaveLength(1);
    expect(body.modes[0]?.modeId).toBe('screen');
    expect(body.modes[0]?.exec).toBe('headless');
    expect(body.modes[0]?.default_platform).toBe('claude');
    expect(body.modes[0]?.default_model).toBe('claude-haiku-4-5-20251001');
  });
});
