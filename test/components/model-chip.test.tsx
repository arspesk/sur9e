// test/components/model-chip.test.tsx
//
// ModelChip: provider·model pill + picker. Renders the real
// useProviderInfo/useSettingsQuery hooks against a stubbed fetch (the REAL
// {providers}/{settings} envelopes the committed /api/providers and
// /api/settings routes return) so a regression to the wrong response shape
// shows up here. Exercises the resolveModeRuntime-mirroring waterfall:
// per-conversation override → settings.providers.modes.chat →
// settings.providers.default_* → hard fallback ('claude' /
// 'claude-sonnet-4-6') — and the picker's installed/not-installed gating.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelChip } from '@/features/chat/model-chip';
import type { SettingsState } from '@/hooks/use-settings';
import type { ProviderInfoEntry, ProvidersResponse } from '@/lib/schemas/providers';
import { DRAFT_OVERRIDE_KEY, useChatStore } from '@/stores/chat-store';

function makeProvider(overrides: Partial<ProviderInfoEntry> = {}): ProviderInfoEntry {
  return {
    id: 'claude',
    displayName: 'Claude Code',
    binary: 'claude',
    installHint: 'npm i -g @anthropic-ai/claude-code',
    installed: { ok: true },
    auth: { ok: true },
    models: [{ id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }],
    ...overrides,
  };
}

function stubFetch(
  providers: ProvidersResponse,
  settings: SettingsState,
  opts?: { deferProviders?: boolean },
) {
  let resolveProviders: (() => void) | undefined;
  const providersGate = opts?.deferProviders
    ? new Promise<void>(resolve => {
        resolveProviders = resolve;
      })
    : Promise.resolve();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href === '/api/providers') {
        await providersGate;
        return { ok: true, status: 200, json: async () => providers } as Response;
      }
      if (href === '/api/settings') {
        return { ok: true, status: 200, json: async () => settings } as Response;
      }
      throw new Error(`unexpected fetch: ${href}`);
    }),
  );
  return { resolveProviders };
}

function renderChip() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ModelChip />, { wrapper });
}

beforeEach(() => {
  useChatStore.setState({ activeConversationId: null, modelOverride: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ModelChip', () => {
  it('falls back to the hard-coded pair when settings + overrides are empty', async () => {
    stubFetch({ providers: {} }, {});
    renderChip();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Model: claude-sonnet-4-6/ })).toBeInTheDocument(),
    );
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();
  });

  it('prefers settings.providers.default_provider/default_model over the hard fallback', async () => {
    stubFetch(
      { providers: {} },
      { providers: { default_provider: 'codex', default_model: 'gpt-6-codex' } },
    );
    renderChip();
    await waitFor(() => expect(screen.getByText('gpt-6-codex')).toBeInTheDocument());
  });

  it('prefers settings.providers.modes.chat over the global default pair', async () => {
    stubFetch(
      { providers: {} },
      {
        providers: {
          default_provider: 'codex',
          default_model: 'gpt-6-codex',
          modes: { chat: { platform: 'opencode', model: 'kimi-k2.6' } },
        },
      },
    );
    renderChip();
    await waitFor(() => expect(screen.getByText('kimi-k2.6')).toBeInTheDocument());
  });

  it('a draft (pre-conversation) store override wins over settings', async () => {
    stubFetch(
      { providers: {} },
      { providers: { default_provider: 'codex', default_model: 'gpt-6-codex' } },
    );
    useChatStore.setState({
      activeConversationId: null,
      modelOverride: { [DRAFT_OVERRIDE_KEY]: { provider: 'opencode', model: 'kimi-k2.6' } },
    });
    renderChip();
    await waitFor(() => expect(screen.getByText('kimi-k2.6')).toBeInTheDocument());
  });

  it('a per-conversation override is keyed by the active conversation id, not the draft key', async () => {
    stubFetch({ providers: {} }, {});
    useChatStore.setState({
      activeConversationId: 'conv-1',
      modelOverride: {
        [DRAFT_OVERRIDE_KEY]: { provider: 'opencode', model: 'kimi-k2.6' },
        'conv-1': { provider: 'codex', model: 'gpt-6-codex' },
      },
    });
    renderChip();
    // conv-1's own override wins, not the stale draft entry.
    await waitFor(() => expect(screen.getByText('gpt-6-codex')).toBeInTheDocument());
  });

  it('shows "Loading models…" while /api/providers is in flight', async () => {
    const { resolveProviders } = stubFetch({ providers: {} }, {}, { deferProviders: true });
    renderChip();
    fireEvent.click(screen.getByRole('button', { name: /Model:/ }));
    await waitFor(() => expect(screen.getByText('Loading models…')).toBeInTheDocument());
    resolveProviders?.();
    await waitFor(() => expect(screen.queryByText('Loading models…')).not.toBeInTheDocument());
  });

  it('lists providers/models, disables uninstalled providers, and picking a model updates the store + closes', async () => {
    stubFetch(
      {
        providers: {
          claude: makeProvider(),
          codex: makeProvider({
            id: 'codex',
            displayName: 'Codex',
            installed: { ok: false },
            models: [{ id: 'gpt-6-codex', label: 'GPT-6 Codex' }],
          }),
        },
      },
      {},
    );
    renderChip();
    fireEvent.click(screen.getByRole('button', { name: /Model:/ }));

    await waitFor(() => expect(screen.getByText('Claude Code')).toBeInTheDocument());
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('· not installed')).toBeInTheDocument();

    const codexItem = screen.getByRole('button', { name: 'GPT-6 Codex' });
    expect(codexItem).toBeDisabled();

    const sonnetItem = screen.getByRole('button', { name: 'Sonnet 4.6' });
    expect(sonnetItem).not.toBeDisabled();
    expect(sonnetItem.getAttribute('data-active')).toBe('true'); // matches the resolved fallback pair

    fireEvent.click(codexItem);
    // Disabled buttons don't fire onClick — store + chip label stay unchanged.
    expect(useChatStore.getState().modelOverride[DRAFT_OVERRIDE_KEY]).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Sonnet 4.6' }));
    await waitFor(() =>
      expect(useChatStore.getState().modelOverride[DRAFT_OVERRIDE_KEY]).toEqual({
        provider: 'claude',
        model: 'claude-sonnet-4-6',
      }),
    );
    // Menu closes after picking.
    await waitFor(() => expect(screen.queryByText('Claude Code')).not.toBeInTheDocument());
  });
});
