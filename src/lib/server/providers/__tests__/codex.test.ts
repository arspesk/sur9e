// src/lib/server/providers/__tests__/codex.test.ts
//
// Tests for the Codex adapter. Asserts headless argv shape,
// the unified-event mapping for Codex's `--json` NDJSON stream, the
// `~/.codex/models_cache.json`-driven model list, the
// install/auth/rate-limit/model-not-found classifier, and (importantly) that
// the three unsupported `BuildHeadlessOpts` fields (`tools`,
// `appendSystemPromptFile`, `pipeToParser: true`) fail LOUD rather than
// silently degrading — Codex has no per-call tool restriction (tools are
// MCP-server configured) and no system-prompt-file flag, so silently ignoring
// either would produce surprising runs.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import codex from '../codex';

describe('codex provider', () => {
  describe('buildHeadlessArgs', () => {
    it('produces codex exec --json + autonomous flags + CODEX_QUIET_MODE env', () => {
      const { cmd, args, env } = codex.buildHeadlessArgs({
        prompt: 'Evaluate offer #42',
        model: 'gpt-5.5',
      });
      expect(cmd).toBe('/bin/bash');
      expect(args[0]).toBe('-c');
      expect(args[1]).toContain('codex exec');
      expect(args[1]).toContain('--json');
      expect(args[1]).toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(args[1]).toContain('--model gpt-5.5');
      expect(env).toMatchObject({ CODEX_QUIET_MODE: '1' });
    });

    it('respects outputFormat: "text" by omitting --json', () => {
      const { args } = codex.buildHeadlessArgs({
        prompt: 'X',
        model: 'gpt-5.5',
        outputFormat: 'text',
      });
      expect(args[1]).not.toContain('--json');
    });

    it('skipPermissions: false omits the approval-bypass flags', () => {
      const { args } = codex.buildHeadlessArgs({
        prompt: 'X',
        model: 'gpt-5.5',
        skipPermissions: false,
      });
      expect(args[1]).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    });

    it('throws on unsupported tools option', () => {
      expect(() =>
        codex.buildHeadlessArgs({
          prompt: 'X',
          model: 'gpt-5.5',
          tools: ['shell', 'web'],
        }),
      ).toThrow(/Codex.*tools/i);
    });

    it('throws on unsupported appendSystemPromptFile', () => {
      expect(() =>
        codex.buildHeadlessArgs({
          prompt: 'X',
          model: 'gpt-5.5',
          appendSystemPromptFile: '/tmp/sys.md',
        }),
      ).toThrow(/Codex.*system.*prompt/i);
    });

    it('throws on unsupported pipeToParser: true', () => {
      expect(() =>
        codex.buildHeadlessArgs({
          prompt: 'X',
          model: 'gpt-5.5',
          pipeToParser: true,
        }),
      ).toThrow(/Codex.*parser/i);
    });
  });

  describe('parseStreamLine', () => {
    it('maps thread.started, item.completed reasoning/tool_use/message, and turn.completed', () => {
      const lines = readFileSync(join(__dirname, 'fixtures/codex-stream.jsonl'), 'utf-8')
        .split('\n')
        .filter(Boolean);
      const events = lines.map(l => codex.parseStreamLine(l)).filter(Boolean);
      const kinds = events.map(e => e!.kind);
      expect(kinds).toContain('stage'); // thread.started
      expect(kinds).toContain('thinking'); // reasoning
      expect(kinds).toContain('tool'); // tool_use
      expect(kinds).toContain('tokens'); // turn.completed
      const tokens = events.find(e => e!.kind === 'tokens');
      expect(tokens?.tokens).toMatchObject({
        in: 3120,
        out: 540,
        model: 'gpt-5.5',
        estimated: false,
      });
    });

    it('returns null for unparseable lines', () => {
      expect(codex.parseStreamLine('garbage')).toBeNull();
      expect(codex.parseStreamLine('')).toBeNull();
    });
  });

  describe('listModels', () => {
    // The model list comes from `~/.codex/models_cache.json`, a file Codex
    // maintains itself. We stub HOME per-test to a tmpdir so a dev's real
    // cache doesn't bleed into assertions and tests can construct the
    // exact cache shape they want to assert against.
    let originalHome: string | undefined;

    beforeEach(() => {
      originalHome = process.env.HOME;
    });
    afterEach(() => {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    });

    it('reads models from ~/.codex/models_cache.json filtered to picker-visible + API-supported entries', async () => {
      // Mirrors the real cache file shape: a mix of picker-shown,
      // hidden, and not-yet-API-available entries. Only the
      // visibility=list + supported_in_api=true ones should surface.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(
        join(fakeHome, '.codex/models_cache.json'),
        JSON.stringify({
          fetched_at: '2026-05-25T04:49:50.005292Z',
          client_version: '0.133.0',
          models: [
            {
              slug: 'gpt-5.5',
              display_name: 'GPT-5.5',
              visibility: 'list',
              supported_in_api: true,
            },
            {
              slug: 'gpt-5.4',
              display_name: 'GPT-5.4',
              visibility: 'list',
              supported_in_api: true,
            },
            {
              slug: 'gpt-5.4-mini',
              display_name: 'GPT-5.4-Mini',
              visibility: 'list',
              supported_in_api: true,
            },
            {
              // Hidden in the picker — must be filtered out.
              slug: 'codex-auto-review',
              display_name: 'Codex Auto Review',
              visibility: 'hide',
              supported_in_api: true,
            },
            {
              // visibility=list but not API-supported — must be filtered out.
              slug: 'preview-only-model',
              display_name: 'Preview Only',
              visibility: 'list',
              supported_in_api: false,
            },
          ],
        }),
      );
      process.env.HOME = fakeHome;

      const models = await codex.listModels();
      expect(models).toEqual([
        { id: 'gpt-5.5', label: 'GPT-5.5' },
        { id: 'gpt-5.4', label: 'GPT-5.4' },
        { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
      ]);
    });

    it('uses the slug as the label when display_name is missing or empty', async () => {
      // Defensive: some cache entries have an empty/missing display_name;
      // we should not render an empty label in the picker.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(
        join(fakeHome, '.codex/models_cache.json'),
        JSON.stringify({
          models: [
            { slug: 'gpt-5.5', display_name: '', visibility: 'list', supported_in_api: true },
            { slug: 'gpt-5.4', visibility: 'list', supported_in_api: true },
          ],
        }),
      );
      process.env.HOME = fakeHome;

      const models = await codex.listModels();
      expect(models).toEqual([
        { id: 'gpt-5.5', label: 'gpt-5.5' },
        { id: 'gpt-5.4', label: 'gpt-5.4' },
      ]);
    });

    it('falls back to FALLBACK_MODELS when the cache file is missing', async () => {
      // Fresh install: HOME exists but no .codex directory yet.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      process.env.HOME = fakeHome;

      const models = await codex.listModels();
      const ids = models.map(m => m.id);
      expect(ids).toContain('gpt-5.5');
      expect(ids).toContain('gpt-5.4');
      expect(ids).toContain('gpt-5.4-mini');
      expect(ids).toContain('gpt-5.3-codex');
      expect(ids).toContain('gpt-5.2');
      // No duplicates:
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('falls back to FALLBACK_MODELS when the cache file is malformed JSON', async () => {
      // Corrupt cache: must not crash the Settings page.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(join(fakeHome, '.codex/models_cache.json'), '{not valid json');
      process.env.HOME = fakeHome;

      const models = await codex.listModels();
      const ids = models.map(m => m.id);
      expect(ids).toContain('gpt-5.5');
      expect(models.length).toBeGreaterThan(0);
    });

    it('falls back to FALLBACK_MODELS when no entries qualify (all hidden or not API-supported)', async () => {
      // Defensive: cache file present but every entry is filtered out.
      // Returning [] would render an empty picker — we'd rather show the
      // fallback than a broken dropdown.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(
        join(fakeHome, '.codex/models_cache.json'),
        JSON.stringify({
          models: [
            { slug: 'hidden-1', visibility: 'hide', supported_in_api: true },
            { slug: 'no-api-1', visibility: 'list', supported_in_api: false },
          ],
        }),
      );
      process.env.HOME = fakeHome;

      const models = await codex.listModels();
      const ids = models.map(m => m.id);
      expect(ids).toContain('gpt-5.5');
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('classifyExitError', () => {
    it('classifies OPENAI_API_KEY missing as auth', () => {
      expect(codex.classifyExitError('OPENAI_API_KEY not set', 1)).toBe('auth');
      expect(codex.classifyExitError('unauthorized', 1)).toBe('auth');
    });
    it('classifies rate limits', () => {
      expect(codex.classifyExitError('rate limit exceeded', 1)).toBe('rate_limit');
      expect(codex.classifyExitError('429 too many requests', 1)).toBe('rate_limit');
    });
    it('classifies model not found', () => {
      expect(codex.classifyExitError('model gpt-future-99 does not exist', 1)).toBe(
        'model_not_found',
      );
    });
    it('classifies missing binary as install', () => {
      expect(codex.classifyExitError('codex: command not found', 127)).toBe('install');
    });
    it('returns unknown for unmatched stderr', () => {
      expect(codex.classifyExitError('weird stuff', 99)).toBe('unknown');
    });
  });
});
