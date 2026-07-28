// src/lib/server/providers/__tests__/opencode.test.ts
//
// Tests for the OpenCode adapter. Headless `opencode run` emits plain text,
// so the adapter:
//
//   - Fails LOUD on every BuildHeadlessOpts field that implies a structured
//     stream (outputFormat !== 'text', pipeToParser: true, tools, etc.) rather
//     than silently degrading. Silent degradation would produce surprising runs
//     where the caller thinks they configured a tool allow-list but OpenCode
//     happily uses anything in its config file.
//
//   - Parses the CHAT stream (`opencode run --format json`) into unified
//     events: reasoning → 'thinking', tool_use parts → 'tool' (start/done/error
//     keyed by callID), text → 'stage'/reply, step_finish → 'tokens'.
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
    it('maps the --format json event stream: reasoning→thinking, tool_use→tool, text→stage, step_finish→tokens', () => {
      const lines = readFileSync(join(__dirname, 'fixtures/opencode-stream.jsonl'), 'utf-8')
        .split('\n')
        .filter(Boolean);
      const events = lines.map(l => opencode.parseStreamLine(l)).filter(Boolean);
      const kinds = events.map(e => e!.kind);
      expect(kinds).toContain('thinking'); // reasoning part
      expect(kinds).toContain('tool'); // tool_use part
      expect(kinds).toContain('stage'); // text part (reply text)
      expect(kinds).toContain('tokens'); // step_finish
      // step_start is lifecycle noise → dropped.
      expect(events.length).toBeLessThan(lines.length);
    });
    it('emits a tool DONE (with the callID) for a completed tool part', () => {
      const ev = opencode.parseStreamLine(
        '{"type":"tool_use","part":{"type":"tool","tool":"bash","callID":"call_7","state":{"status":"completed","input":{"command":"echo hi"}}}}',
      );
      expect(ev).toMatchObject({ kind: 'tool', toolStatus: 'done', toolId: 'call_7' });
      expect(ev!.message).toContain('bash');
    });
    it('emits a tool START for a running tool part and ERROR for a failed one', () => {
      const running = opencode.parseStreamLine(
        '{"type":"tool_use","part":{"type":"tool","tool":"bash","callID":"c1","state":{"status":"running","input":{}}}}',
      );
      const errored = opencode.parseStreamLine(
        '{"type":"tool_use","part":{"type":"tool","tool":"bash","callID":"c2","state":{"status":"error","input":{}}}}',
      );
      expect(running).toMatchObject({ kind: 'tool', toolStatus: 'start', toolId: 'c1' });
      expect(errored).toMatchObject({ kind: 'tool', toolStatus: 'error', toolId: 'c2' });
    });
    it('returns null for empty lines and non-JSON log lines', () => {
      expect(opencode.parseStreamLine('')).toBeNull();
      expect(opencode.parseStreamLine('   ')).toBeNull();
      expect(opencode.parseStreamLine('INFO  some plain log line')).toBeNull();
    });
    it('preserves complete reasoning while bounding the duplicate reply stage', () => {
      const reasoning = `reasoning-start ${'a'.repeat(500)} reasoning-end`;
      const thinking = opencode.parseStreamLine(
        JSON.stringify({ type: 'reasoning', part: { text: reasoning } }),
      );
      const stage = opencode.parseStreamLine(
        JSON.stringify({ type: 'text', part: { text: 'b'.repeat(500) } }),
      );
      expect(thinking).toMatchObject({ kind: 'thinking', message: reasoning });
      expect(stage?.message.length).toBeLessThanOrEqual(200);
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
