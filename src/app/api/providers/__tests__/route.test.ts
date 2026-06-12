// src/app/api/providers/__tests__/route.test.ts
//
// Integration test for GET /api/providers. Mocks the provider registry
// so the route never spawns real CLI binaries — the unit under test is
// the aggregation logic + per-adapter .catch wrappers, not the adapters
// themselves (those have their own tests under
// src/lib/server/providers/__tests__).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '@/lib/server/providers/types';

function fakeProvider(
  id: 'claude' | 'codex' | 'opencode',
  overrides?: Partial<Provider>,
): Provider {
  return {
    id,
    displayName: `Fake ${id}`,
    binary: id,
    installHint: `install ${id}`,
    buildHeadlessArgs: () => ({ cmd: id, args: [] }),
    buildInteractiveLaunch: () => ({ cmd: id, args: [] }),
    parseStreamLine: () => null,
    listModels: vi.fn(async () => [{ id: `${id}-m1`, label: `${id} model` }]),
    checkInstalled: vi.fn(async () => ({ ok: true, version: '1.0.0' })),
    checkAuth: vi.fn(async () => ({ ok: true })),
    classifyExitError: () => 'unknown',
    ...overrides,
  };
}

// The mock factory MUST live above any imports of code that pulls in
// the registry. Vitest hoists vi.mock() calls so the module map is
// rewritten before any imports execute.
//
// We mutate the PROVIDERS object in place (rather than vi.resetModules()
// + dynamic import) because that pattern doesn't survive the hoist —
// the registry module captures the wrong identity at re-import time.
const providersHolder: { current: Record<string, Provider> } = {
  current: {
    claude: fakeProvider('claude'),
    codex: fakeProvider('codex'),
    opencode: fakeProvider('opencode'),
  },
};

vi.mock('@/lib/server/providers/registry', () => ({
  get PROVIDERS() {
    return providersHolder.current;
  },
}));

beforeEach(() => {
  providersHolder.current = {
    claude: fakeProvider('claude'),
    codex: fakeProvider('codex'),
    opencode: fakeProvider('opencode'),
  };
});

describe('GET /api/providers', () => {
  it('returns one entry per registered provider with health + models', async () => {
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Record<string, { id: string; installed: { ok: boolean }; models: unknown[] }>;
    };
    expect(Object.keys(body.providers).sort()).toEqual(['claude', 'codex', 'opencode']);
    expect(body.providers.claude!.installed.ok).toBe(true);
    expect(body.providers.codex!.models).toHaveLength(1);
  });

  it('does not throw when an adapter probe rejects — wraps with degraded state', async () => {
    providersHolder.current.opencode = fakeProvider('opencode', {
      checkInstalled: vi.fn(async () => {
        throw new Error('binary not found');
      }),
      checkAuth: vi.fn(async () => {
        throw new Error('no token');
      }),
      listModels: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Record<
        string,
        {
          installed: { ok: boolean; error?: string };
          auth: { ok: boolean; warning?: string };
          models: unknown[];
        }
      >;
    };
    expect(body.providers.opencode!.installed.ok).toBe(false);
    expect(body.providers.opencode!.installed.error).toMatch(/binary not found/);
    expect(body.providers.opencode!.auth.ok).toBe(false);
    expect(body.providers.opencode!.auth.warning).toMatch(/no token/);
    expect(body.providers.opencode!.models).toEqual([]);
    // Other providers should still report cleanly.
    expect(body.providers.claude!.installed.ok).toBe(true);
  });

  it('returns the provider metadata (displayName, binary, installHint)', async () => {
    const { GET } = await import('../route');
    const res = await GET();
    const body = (await res.json()) as {
      providers: Record<string, { displayName: string; binary: string; installHint: string }>;
    };
    expect(body.providers.claude!.displayName).toBe('Fake claude');
    expect(body.providers.claude!.binary).toBe('claude');
    expect(body.providers.claude!.installHint).toBe('install claude');
  });
});
