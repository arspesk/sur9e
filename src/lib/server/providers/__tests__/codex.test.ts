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

  describe('buildChatArgs (constrained chat assistant)', () => {
    // Writes a turn MCP config (the claude-format file the turn runner emits)
    // so buildChatArgs can lift the turn-id env out of it via readTurnMcpConfig.
    function writeTurnConfig(turnId: string, appUrl: string): string {
      const dir = mkdtempSync(join(tmpdir(), 'sur9e-codex-chat-'));
      const path = join(dir, 'turn.json');
      writeFileSync(
        path,
        JSON.stringify({
          mcpServers: {
            'sur9e-app': {
              command: 'node',
              args: ['/repo/cli/mcp-app-server.mjs'],
              env: { SUR9E_APP_URL: appUrl, SUR9E_CHAT_TURN_ID: turnId, SUR9E_ROOT: '/repo' },
            },
          },
        }),
      );
      return path;
    }

    it('runs read-only + auto-approves the sur9e-app MCP server + disables the skill hijack (never the autonomous bypass)', () => {
      const { cmd, args, env } = codex.buildChatArgs({
        promptFile: '/tmp/prompt.md',
        model: 'gpt-5.4-mini',
      });
      expect(cmd).toBe('/bin/bash');
      const cmdline = args[1];
      expect(cmdline).toContain('codex exec');
      expect(cmdline).toContain('--json');
      // Read-only filesystem posture — NOT the autonomous flag (which would let
      // a chat turn mutate the repo).
      expect(cmdline).toContain('--sandbox read-only');
      expect(cmdline).not.toContain('--dangerously-bypass-approvals-and-sandbox');
      // Stops the AGENTS.md hijack.
      expect(cmdline).toContain('project_doc_max_bytes=0');
      // THE MCP-cancellation fix: pre-approve the sur9e-app server's tool calls
      // so they run under the sandbox in non-interactive exec instead of coming
      // back "user cancelled MCP tool call".
      expect(cmdline).toContain('mcp_servers.sur9e-app.default_tools_approval_mode="approve"');
      // Tools-only: both exec surfaces are disabled so the model can never shell
      // out to explore the repo (skill files, mode files); the `sur9e` router
      // skill is also kept out of context.
      expect(cmdline).toContain('--disable shell_tool');
      expect(cmdline).toContain('--disable unified_exec');
      expect(cmdline).toContain('--disable skill_search');
      expect(env).toMatchObject({ CODEX_QUIET_MODE: '1' });
    });

    it('injects the turn id + app url into the sur9e-app MCP server env (confirm-card wiring)', () => {
      const mcpConfigPath = writeTurnConfig('turn-abc-123', 'http://localhost:3100');
      const { args } = codex.buildChatArgs({
        promptFile: '/tmp/prompt.md',
        model: 'gpt-5.4-mini',
        mcpConfigPath,
      });
      const cmdline = args[1];
      expect(cmdline).toContain('mcp_servers.sur9e-app.env.SUR9E_CHAT_TURN_ID="turn-abc-123"');
      expect(cmdline).toContain('mcp_servers.sur9e-app.env.SUR9E_APP_URL="http://localhost:3100"');
      // The auto-approve override rides alongside the per-turn env overrides.
      expect(cmdline).toContain('mcp_servers.sur9e-app.default_tools_approval_mode="approve"');
    });

    it('throws when handed a resumeSessionId (resume is gated off for codex)', () => {
      expect(() =>
        codex.buildChatArgs({
          promptFile: '/tmp/prompt.md',
          model: 'gpt-5.4-mini',
          resumeSessionId: 'sess-1',
        }),
      ).toThrow(/resume/i);
    });
  });

  describe('parseStreamLine', () => {
    it('maps the real 0.142 thread-event stream: reasoning→thinking, item tool lifecycle, agent_message→stage, turn.completed→tokens', () => {
      const lines = readFileSync(join(__dirname, 'fixtures/codex-stream.jsonl'), 'utf-8')
        .split('\n')
        .filter(Boolean);
      const events = lines.map(l => codex.parseStreamLine(l)).filter(Boolean);
      const kinds = events.map(e => e!.kind);
      expect(kinds).toContain('thinking'); // reasoning item
      expect(kinds).toContain('tool'); // command_execution + mcp_tool_call
      expect(kinds).toContain('stage'); // agent_message (reply text)
      expect(kinds).toContain('tokens'); // turn.completed
      const tokens = events.find(e => e!.kind === 'tokens');
      // codex's usage block carries no model id — left empty so the caller
      // falls back to the selected model.
      expect(tokens?.tokens).toMatchObject({ in: 3120, out: 540, model: '', estimated: false });
    });

    it('drops infra handshakes and plugin-error items (never a transcript stage)', () => {
      expect(codex.parseStreamLine('{"type":"thread.started","thread_id":"t1"}')).toBeNull();
      expect(codex.parseStreamLine('{"type":"turn.started"}')).toBeNull();
      expect(
        codex.parseStreamLine(
          '{"type":"item.completed","item":{"id":"i","type":"error","message":"plugin hook noise"}}',
        ),
      ).toBeNull();
    });

    it('emits paired tool START/DONE (with the item id) for command_execution', () => {
      const started = codex.parseStreamLine(
        '{"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"curl x","status":"in_progress"}}',
      );
      const completed = codex.parseStreamLine(
        '{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"curl x","exit_code":0,"status":"completed"}}',
      );
      expect(started).toMatchObject({ kind: 'tool', toolStatus: 'start', toolId: 'item_2' });
      expect(completed).toMatchObject({ kind: 'tool', toolStatus: 'done', toolId: 'item_2' });
      expect(started!.message).toContain('shell');
    });

    it('marks a non-zero-exit command_execution as a tool ERROR', () => {
      const failed = codex.parseStreamLine(
        '{"type":"item.completed","item":{"id":"item_9","type":"command_execution","command":"false","exit_code":1,"status":"failed"}}',
      );
      expect(failed).toMatchObject({ kind: 'tool', toolStatus: 'error', toolId: 'item_9' });
    });

    it('names an mcp_tool_call chip <server>.<tool>', () => {
      const started = codex.parseStreamLine(
        '{"type":"item.started","item":{"id":"m1","type":"mcp_tool_call","server":"sur9e-app","tool":"get_report","status":"in_progress"}}',
      );
      expect(started).toMatchObject({ kind: 'tool', toolStatus: 'start', toolId: 'm1' });
      expect(started!.message).toContain('sur9e-app.get_report');
    });

    it('reads reasoning text from the item.text field', () => {
      const ev = codex.parseStreamLine(
        '{"type":"item.completed","item":{"id":"r1","type":"reasoning","text":"weighing options"}}',
      );
      expect(ev).toMatchObject({ kind: 'thinking' });
      expect(ev!.message).toContain('weighing options');
    });

    it('preserves the complete reasoning text', () => {
      const reasoning = `reasoning-start ${'a'.repeat(500)} reasoning-end`;
      const ev = codex.parseStreamLine(
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'r1', type: 'reasoning', text: reasoning },
        }),
      );
      expect(ev).toMatchObject({ kind: 'thinking', message: reasoning });
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
    // exact cache shape they want to assert against. CODEX_API_KEY is
    // cleared too — it forces API-key auth mode, which changes which cache
    // entries qualify (see the auth-mode tests below).
    let originalHome: string | undefined;
    let originalCodexApiKey: string | undefined;

    beforeEach(() => {
      originalHome = process.env.HOME;
      originalCodexApiKey = process.env.CODEX_API_KEY;
      delete process.env.CODEX_API_KEY;
    });
    afterEach(() => {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalCodexApiKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = originalCodexApiKey;
    });

    it('reads models from ~/.codex/models_cache.json filtered to picker-visible + API-supported entries', async () => {
      // Mirrors the real cache file shape: a mix of picker-shown,
      // hidden, and not-yet-API-available entries. With no auth.json in
      // the fake HOME the auth mode is unknown, so the strict filter
      // applies: only visibility=list + supported_in_api=true surface.
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
              // visibility=list but not API-supported — filtered out in
              // API-key/unknown auth mode (kept under ChatGPT auth; see
              // the ChatGPT-auth test below).
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

    it('keeps supported_in_api=false models under ChatGPT auth, matching the codex /model picker', async () => {
      // Issue #89: `gpt-5.3-codex-spark` is `visibility: list` but
      // `supported_in_api: false`. Codex's own picker filter
      // (ModelPreset::filter_by_auth) only applies `supported_in_api` in
      // API-key mode; under ChatGPT login (`codex login` → auth.json with
      // `tokens`) all picker-visible models show and run fine.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(
        join(fakeHome, '.codex/auth.json'),
        JSON.stringify({
          OPENAI_API_KEY: null,
          tokens: { id_token: 'x', access_token: 'y', refresh_token: 'z', account_id: 'a' },
          last_refresh: '2026-08-14T00:00:00Z',
        }),
      );
      writeFileSync(
        join(fakeHome, '.codex/models_cache.json'),
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.5',
              display_name: 'GPT-5.5',
              visibility: 'list',
              supported_in_api: true,
            },
            {
              slug: 'gpt-5.3-codex-spark',
              display_name: 'GPT-5.3-Codex-Spark',
              visibility: 'list',
              supported_in_api: false,
            },
            {
              // Hidden entries stay excluded regardless of auth mode.
              slug: 'codex-auto-review',
              display_name: 'Codex Auto Review',
              visibility: 'hide',
              supported_in_api: true,
            },
          ],
        }),
      );
      process.env.HOME = fakeHome;

      const models = await codex.listModels();
      expect(models).toEqual([
        { id: 'gpt-5.5', label: 'GPT-5.5' },
        { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark' },
      ]);
    });

    it('honors an explicit auth_mode: "chatgpt" even when a stored API key is also present', async () => {
      // AuthDotJson::resolved_mode gives the explicit `auth_mode` field top
      // priority over stored credentials, so a leftover stored key must not
      // flip a declared-ChatGPT auth.json into API-key mode.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(
        join(fakeHome, '.codex/auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: 'sk-stale-leftover',
          tokens: { access_token: 'y' },
        }),
      );
      writeFileSync(
        join(fakeHome, '.codex/models_cache.json'),
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.5',
              display_name: 'GPT-5.5',
              visibility: 'list',
              supported_in_api: true,
            },
            {
              slug: 'gpt-5.3-codex-spark',
              display_name: 'GPT-5.3-Codex-Spark',
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
        { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark' },
      ]);
    });

    it('honors an explicit auth_mode: "apikey" even when ChatGPT tokens are also present', async () => {
      // The inverse mixed-credential state: declared API-key mode wins over
      // leftover ChatGPT tokens, so the API-supported subset applies.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(
        join(fakeHome, '.codex/auth.json'),
        JSON.stringify({
          auth_mode: 'apikey',
          OPENAI_API_KEY: null,
          tokens: { access_token: 'y' },
        }),
      );
      writeFileSync(
        join(fakeHome, '.codex/models_cache.json'),
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.5',
              display_name: 'GPT-5.5',
              visibility: 'list',
              supported_in_api: true,
            },
            {
              slug: 'gpt-5.3-codex-spark',
              display_name: 'GPT-5.3-Codex-Spark',
              visibility: 'list',
              supported_in_api: false,
            },
          ],
        }),
      );
      process.env.HOME = fakeHome;

      const models = await codex.listModels();
      expect(models).toEqual([{ id: 'gpt-5.5', label: 'GPT-5.5' }]);
    });

    it('filters supported_in_api=false models when auth.json holds a stored API key', async () => {
      // `codex login --api-key` stores the key in auth.json without ChatGPT
      // tokens → API-key mode: `supported_in_api: false` models are genuinely
      // not callable, so codex (and we) drop them from the picker. Would
      // fail if the supported_in_api condition were removed outright.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(
        join(fakeHome, '.codex/auth.json'),
        JSON.stringify({ OPENAI_API_KEY: 'sk-test-123', last_refresh: null }),
      );
      writeFileSync(
        join(fakeHome, '.codex/models_cache.json'),
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.5',
              display_name: 'GPT-5.5',
              visibility: 'list',
              supported_in_api: true,
            },
            {
              slug: 'gpt-5.3-codex-spark',
              display_name: 'GPT-5.3-Codex-Spark',
              visibility: 'list',
              supported_in_api: false,
            },
          ],
        }),
      );
      process.env.HOME = fakeHome;

      const models = await codex.listModels();
      expect(models).toEqual([{ id: 'gpt-5.5', label: 'GPT-5.5' }]);
    });

    it('lets CODEX_API_KEY env force API-key mode even when ChatGPT tokens exist', async () => {
      // Codex gives the CODEX_API_KEY env var top precedence over auth.json,
      // so its presence flips the picker to the API-supported subset.
      const fakeHome = mkdtempSync(join(tmpdir(), 'sur9e-codex-cache-'));
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(
        join(fakeHome, '.codex/auth.json'),
        JSON.stringify({ OPENAI_API_KEY: null, tokens: { access_token: 'y' } }),
      );
      writeFileSync(
        join(fakeHome, '.codex/models_cache.json'),
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.5',
              display_name: 'GPT-5.5',
              visibility: 'list',
              supported_in_api: true,
            },
            {
              slug: 'gpt-5.3-codex-spark',
              display_name: 'GPT-5.3-Codex-Spark',
              visibility: 'list',
              supported_in_api: false,
            },
          ],
        }),
      );
      process.env.HOME = fakeHome;
      process.env.CODEX_API_KEY = 'sk-env-key';

      const models = await codex.listModels();
      expect(models).toEqual([{ id: 'gpt-5.5', label: 'GPT-5.5' }]);
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
      // The fallback only lists ids codex 0.142 actually runs. gpt-5.3-codex /
      // gpt-5.2 were REMOVED — codex rejects them ("Model metadata not found"),
      // which surfaced as "That model isn't available" for cache-less users.
      expect(ids).not.toContain('gpt-5.3-codex');
      expect(ids).not.toContain('gpt-5.2');
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
