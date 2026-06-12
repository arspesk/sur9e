// openrouter-mapper.test.ts — verifies that sur9e provider:model IDs
// translate to the right OpenRouter IDs. Pure string-transform unit
// tests; no I/O.

import { describe, expect, it } from 'vitest';
import { mapToOpenRouter } from '../openrouter-mapper';

describe('mapToOpenRouter — Claude', () => {
  it('handles plain N-M version: claude-sonnet-4-6 → anthropic/claude-sonnet-4.6', () => {
    expect(mapToOpenRouter('claude', 'claude-sonnet-4-6')).toBe('anthropic/claude-sonnet-4.6');
  });

  it('handles plain N (no minor): claude-opus-4 → anthropic/claude-opus-4', () => {
    expect(mapToOpenRouter('claude', 'claude-opus-4')).toBe('anthropic/claude-opus-4');
  });

  it('strips the [1m] context-window suffix', () => {
    expect(mapToOpenRouter('claude', 'claude-opus-4-6[1m]')).toBe('anthropic/claude-opus-4.6');
    expect(mapToOpenRouter('claude', 'claude-sonnet-4-5-20250929[1m]')).toBe(
      'anthropic/claude-sonnet-4.5',
    );
  });

  it('strips the 8-digit date suffix', () => {
    expect(mapToOpenRouter('claude', 'claude-haiku-4-5-20251001')).toBe(
      'anthropic/claude-haiku-4.5',
    );
    expect(mapToOpenRouter('claude', 'claude-opus-4-5-20251101')).toBe('anthropic/claude-opus-4.5');
  });

  it('handles legacy Haiku 3.x naming (claude-3.5-haiku swap)', () => {
    expect(mapToOpenRouter('claude', 'claude-haiku-3-5')).toBe('anthropic/claude-3.5-haiku');
    expect(mapToOpenRouter('claude', 'claude-haiku-3')).toBe('anthropic/claude-3-haiku');
  });

  it('returns null for malformed Claude IDs', () => {
    expect(mapToOpenRouter('claude', 'claude-experimental-X')).toBeNull();
    expect(mapToOpenRouter('claude', 'not-a-claude-id')).toBeNull();
  });

  it('handles the fable tier (incl. [1m] variant)', () => {
    expect(mapToOpenRouter('claude', 'claude-fable-5')).toBe('anthropic/claude-fable-5');
    expect(mapToOpenRouter('claude', 'claude-fable-5[1m]')).toBe('anthropic/claude-fable-5');
  });

  it('strips the -1m variant marker', () => {
    expect(mapToOpenRouter('claude', 'claude-opus-4-7-1m')).toBe('anthropic/claude-opus-4.7');
  });
});

describe('mapToOpenRouter — Codex', () => {
  it('prefixes gpt-* with openai/', () => {
    expect(mapToOpenRouter('codex', 'gpt-5.5')).toBe('openai/gpt-5.5');
    expect(mapToOpenRouter('codex', 'gpt-5.4-mini')).toBe('openai/gpt-5.4-mini');
    expect(mapToOpenRouter('codex', 'gpt-5.3-codex')).toBe('openai/gpt-5.3-codex');
  });

  it('returns null for non-gpt model ids', () => {
    expect(mapToOpenRouter('codex', 'o1')).toBeNull();
    expect(mapToOpenRouter('codex', 'codex-experimental')).toBeNull();
  });

  it('routes gpt-5.5-codex to openai/gpt-5.5 via the alias table (no separate OR id)', () => {
    expect(mapToOpenRouter('codex', 'gpt-5.5-codex')).toBe('openai/gpt-5.5');
  });
});

describe('mapToOpenRouter — OpenCode', () => {
  it('maps opencode-go/kimi-* to moonshotai/kimi-*', () => {
    expect(mapToOpenRouter('opencode', 'opencode-go/kimi-k2.6')).toBe('moonshotai/kimi-k2.6');
    expect(mapToOpenRouter('opencode', 'opencode-go/kimi-k2.5')).toBe('moonshotai/kimi-k2.5');
  });

  it('maps opencode-go/qwen* to qwen/qwen*', () => {
    expect(mapToOpenRouter('opencode', 'opencode-go/qwen3.6-plus')).toBe('qwen/qwen3.6-plus');
    expect(mapToOpenRouter('opencode', 'opencode-go/qwen3.5-plus')).toBe('qwen/qwen3.5-plus');
  });

  it('maps opencode-go/glm-* to z-ai/glm-*', () => {
    expect(mapToOpenRouter('opencode', 'opencode-go/glm-5.1')).toBe('z-ai/glm-5.1');
    expect(mapToOpenRouter('opencode', 'opencode-go/glm-5')).toBe('z-ai/glm-5');
  });

  it('maps opencode-go/deepseek-* to deepseek/deepseek-*', () => {
    expect(mapToOpenRouter('opencode', 'opencode-go/deepseek-v4-pro')).toBe(
      'deepseek/deepseek-v4-pro',
    );
  });

  it('maps opencode-go/mimo-* to xiaomi/mimo-*', () => {
    expect(mapToOpenRouter('opencode', 'opencode-go/mimo-v2.5-pro')).toBe('xiaomi/mimo-v2.5-pro');
  });

  it('maps opencode-go/minimax-* to minimax/minimax-*', () => {
    expect(mapToOpenRouter('opencode', 'opencode-go/minimax-m2.7')).toBe('minimax/minimax-m2.7');
  });

  it('maps the known opencode/* free-tier aliases to OR :free ids', () => {
    expect(mapToOpenRouter('opencode', 'opencode/deepseek-v4-flash-free')).toBe(
      'deepseek/deepseek-v4-flash:free',
    );
    expect(mapToOpenRouter('opencode', 'opencode/nemotron-3-super-free')).toBe(
      'nvidia/nemotron-3-super-120b-a12b:free',
    );
  });

  it('returns null for OpenCode-internal aliases under opencode/ without a public vendor map', () => {
    expect(mapToOpenRouter('opencode', 'opencode/big-puzzle')).toBeNull();
    expect(mapToOpenRouter('opencode', 'opencode/unknown-internal')).toBeNull();
  });

  it('returns null for unknown opencode-go/* vendor prefixes', () => {
    expect(mapToOpenRouter('opencode', 'opencode-go/unknown-vendor-model')).toBeNull();
  });
});

describe('mapToOpenRouter — Antigravity', () => {
  it('returns null for unknown providers/ids', () => {});
});
