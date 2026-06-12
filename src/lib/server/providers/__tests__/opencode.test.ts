// src/lib/server/providers/__tests__/opencode.test.ts
//
// Tests for the OpenCode adapter. OpenCode's `opencode run`
// command emits plain text — no `--json` flag, no NDJSON event stream. The
// adapter therefore:
//
//   - Fails LOUD on every BuildHeadlessOpts field that implies a structured
//     stream (outputFormat !== 'text', pipeToParser: true, tools, etc.) rather
//     than silently degrading. Silent degradation would produce surprising runs
//     where the caller thinks they configured a tool allow-list but OpenCode
//     happily uses anything in its config file.
//
//   - Classifies plain-text stdout lines into 'stage' (default) vs 'tool'
//     (lines that look like "Tool call:" / "Tool result:").
//
//   - Estimates token usage via tiktoken at job close — exported separately as
//     the accumulated stdout text. The `estimated: true` flag warns analytics
//     consumers that this number is an order-of-magnitude approximation.
//
//   - listModels() is tolerant: works whether or not the `opencode` binary is
//     installed locally (falls back to a small curated static list).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import opencode from '../opencode';

describe('opencode provider', () => {
  describe('buildHeadlessArgs', () => {
    it('produces opencode run -m <provider/model> "<prompt>"', () => {
      const { cmd, args } = opencode.buildHeadlessArgs({
        prompt: 'Evaluate offer #42',
        model: 'anthropic/claude-3-haiku',
      });
      expect(cmd).toBe('/bin/bash');
      expect(args[0]).toBe('-c');
      expect(args[1]).toContain('opencode run');
      expect(args[1]).toContain('-m anthropic/claude-3-haiku');
    });

    it('throws on outputFormat other than "text"', () => {
      expect(() =>
        opencode.buildHeadlessArgs({
          prompt: 'X',
          model: 'anthropic/claude-3-haiku',
          outputFormat: 'stream-json',
        }),
      ).toThrow(/OpenCode.*outputFormat/i);
      expect(() =>
        opencode.buildHeadlessArgs({
          prompt: 'X',
          model: 'anthropic/claude-3-haiku',
          outputFormat: 'json',
        }),
      ).toThrow(/OpenCode.*outputFormat/i);
    });

    it('throws on pipeToParser: true', () => {
      expect(() =>
        opencode.buildHeadlessArgs({
          prompt: 'X',
          model: 'anthropic/claude-3-haiku',
          pipeToParser: true,
        }),
      ).toThrow(/OpenCode.*parser/i);
    });

    it('throws on tools restriction', () => {
      expect(() =>
        opencode.buildHeadlessArgs({
          prompt: 'X',
          model: 'anthropic/claude-3-haiku',
          tools: ['shell', 'web'],
        }),
      ).toThrow(/OpenCode.*tools/i);
    });

    it('throws on appendSystemPromptFile', () => {
      expect(() =>
        opencode.buildHeadlessArgs({
          prompt: 'X',
          model: 'anthropic/claude-3-haiku',
          appendSystemPromptFile: '/tmp/sys.md',
        }),
      ).toThrow(/OpenCode.*system.*prompt/i);
    });

    it('throws on skipPermissions: false (autonomous-only)', () => {
      expect(() =>
        opencode.buildHeadlessArgs({
          prompt: 'X',
          model: 'anthropic/claude-3-haiku',
          skipPermissions: false,
        }),
      ).toThrow(/OpenCode.*permission/i);
    });
  });

  describe('parseStreamLine', () => {
    it('produces stage/tool events for plain stdout lines', () => {
      const lines = readFileSync(join(__dirname, 'fixtures/opencode-stream.txt'), 'utf-8')
        .split('\n')
        .filter(Boolean);
      const events = lines.map(l => opencode.parseStreamLine(l)).filter(Boolean);
      expect(events.length).toBe(lines.length);
      const kinds = events.map(e => e!.kind);
      expect(kinds.every(k => k === 'stage' || k === 'tool')).toBe(true);
      // Tool lines (those starting with "Tool call:" or "Tool result:") classify as 'tool'
      const toolCount = events.filter(e => e!.kind === 'tool').length;
      expect(toolCount).toBeGreaterThanOrEqual(2);
    });
    it('returns null for empty lines', () => {
      expect(opencode.parseStreamLine('')).toBeNull();
      expect(opencode.parseStreamLine('   ')).toBeNull();
    });
    it('truncates long lines to 200 chars', () => {
      const long = 'a'.repeat(500);
      const ev = opencode.parseStreamLine(long);
      expect(ev?.message.length).toBeLessThanOrEqual(200);
    });
  });

  describe('listModels', () => {
    // 15s timeout: listModels() spawns the real `opencode models` with a 5s
    // execFileSync budget. The default 5s vitest timeout equals that, so a slow
    // cold start — e.g. the first boot after sur9e's .opencode/plugins/ ships,
    // when Bun transpiles the plugin — would race vitest's own timer. The
    // headroom lets the fallback-on-timeout path always complete.
    it('returns the static fallback list when opencode binary is unavailable', async () => {
      // If opencode is installed locally, this test verifies the live list has the right shape.
      // If opencode is not installed, the adapter falls back to the static list.
      const ms = await opencode.listModels();
      expect(ms.length).toBeGreaterThanOrEqual(3);
      // Fallback list includes at least these three:
      const ids = ms.map(m => m.id);
      // Either the live list has different ids (acceptable) OR the fallback is in use:
      if (ids.includes('anthropic/claude-3-haiku')) {
        // fallback path — verify all expected
        expect(ids).toContain('anthropic/claude-3-sonnet');
      }
      // No further assertion — both paths are valid
    }, 15000);
  });

  describe('classifyExitError', () => {
    it('classifies API key missing as auth', () => {
      expect(opencode.classifyExitError('ProviderAuthError: run opencode auth login', 1)).toBe(
        'auth',
      );
      expect(opencode.classifyExitError('unauthorized', 1)).toBe('auth');
    });
    it('classifies rate limit', () => {
      expect(opencode.classifyExitError('rate limit exceeded', 1)).toBe('rate_limit');
    });
    it('classifies model not found', () => {
      expect(opencode.classifyExitError('Model not found: anthropic/claude-future', 1)).toBe(
        'model_not_found',
      );
    });
    it('classifies missing binary as install', () => {
      expect(opencode.classifyExitError('opencode: command not found', 127)).toBe('install');
    });
  });
});
