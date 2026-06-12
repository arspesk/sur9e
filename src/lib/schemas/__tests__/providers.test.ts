// lib/schemas/__tests__/providers.test.ts
//
// Unit tests for the provider-layer zod schemas. Covers ProviderId
// (enum of the 4 supported CLIs), ProviderModelRef (shell-safe model
// id pattern that allows both Claude bare ids and OpenCode
// provider-prefixed ids), and UnifiedStreamEvent (the shared event
// shape all 4 parsers emit).

import { describe, expect, it } from 'vitest';
import { ProviderId, ProviderModelRef, UnifiedStreamEvent } from '../providers';

describe('ProviderId', () => {
  it('accepts the four known ids', () => {
    for (const id of ['claude', 'codex', 'opencode']) {
      expect(ProviderId.parse(id)).toBe(id);
    }
  });
  it('rejects unknown id', () => {
    expect(() => ProviderId.parse('llama')).toThrow();
  });
});

describe('ProviderModelRef', () => {
  it('accepts Claude-style model ids', () => {
    expect(ProviderModelRef.parse('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(ProviderModelRef.parse('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001');
  });
  it('accepts provider-prefixed OpenCode model ids', () => {
    expect(ProviderModelRef.parse('anthropic/claude-3-haiku')).toBe('anthropic/claude-3-haiku');
    expect(ProviderModelRef.parse('openrouter/moonshotai/kimi-k2.6')).toBe(
      'openrouter/moonshotai/kimi-k2.6',
    );
  });
  it('accepts the [1m] context-window variants the Claude picker offers', () => {
    expect(ProviderModelRef.parse('claude-opus-4-7[1m]')).toBe('claude-opus-4-7[1m]');
    expect(ProviderModelRef.parse('claude-sonnet-4-5-20250929[1m]')).toBe(
      'claude-sonnet-4-5-20250929[1m]',
    );
  });
  it('rejects brackets anywhere but a trailing [1m]', () => {
    expect(() => ProviderModelRef.parse('[1m]')).toThrow();
    expect(() => ProviderModelRef.parse('claude[1m]-opus')).toThrow();
    expect(() => ProviderModelRef.parse('claude-opus[2m]')).toThrow();
  });
  it('rejects shell-injection-y model ids', () => {
    expect(() => ProviderModelRef.parse('foo; rm -rf /')).toThrow();
    expect(() => ProviderModelRef.parse('foo$(whoami)')).toThrow();
    expect(() => ProviderModelRef.parse('foo`whoami`')).toThrow();
    expect(() => ProviderModelRef.parse('"quoted"')).toThrow();
  });
});

describe('UnifiedStreamEvent', () => {
  it('accepts a stage event', () => {
    const parsed = UnifiedStreamEvent.parse({
      kind: 'stage',
      message: '[1/4] Loading offer',
      ts: '2026-05-24T22:50:00.000Z',
    });
    expect(parsed.kind).toBe('stage');
  });
  it('accepts a tokens event with the tokens block', () => {
    const parsed = UnifiedStreamEvent.parse({
      kind: 'tokens',
      message: 'Model usage',
      tokens: { in: 1024, out: 512, model: 'claude-sonnet-4-6', estimated: false },
      ts: '2026-05-24T22:50:01.000Z',
    });
    expect(parsed.tokens?.in).toBe(1024);
  });
  it('rejects unknown kind', () => {
    expect(() => UnifiedStreamEvent.parse({ kind: 'sparkle', message: 'x', ts: '' })).toThrow();
  });
});
