import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeMcpConfigForTurn } from '@/lib/server/chat/mcp-config';
import claude from '@/lib/server/providers/claude';
import codex from '@/lib/server/providers/codex';
import opencode from '@/lib/server/providers/opencode';

const base = { promptFile: '/tmp/turn.md', model: 'claude-sonnet-4-6' };

describe('claude.buildChatArgs', () => {
  it('fresh turn: stream-json, session id, read-only tools, no permission bypass', () => {
    const { cmd, args } = claude.buildChatArgs({
      ...base,
      sessionId: '11111111-2222-3333-4444-555555555555',
    });
    expect(cmd).toBe('/bin/bash');
    expect(args[0]).toBe('-c');
    const line = args[1];
    expect(line).toContain('claude -p');
    expect(line).toContain(`--model 'claude-sonnet-4-6'`);
    expect(line).toContain('--output-format stream-json');
    expect(line).toContain('--verbose');
    expect(line).toContain("--session-id '11111111-2222-3333-4444-555555555555'");
    expect(line).not.toContain('--resume');
    expect(line).toContain('--allowedTools "Read,Glob,Grep,WebFetch,WebSearch,mcp__sur9e-app__*"');
    expect(line).toContain('--disallowedTools "Bash,Write,Edit,NotebookEdit,Task"');
    expect(line).not.toContain('--dangerously-skip-permissions');
    // Prompt fed on stdin (not a positional `$(cat …)` arg) to avoid a race
    // with MCP-server startup in -p mode.
    expect(line).toContain(`< '/tmp/turn.md'`);
    expect(line).not.toContain('$(cat');
  });

  it('resume turn: --resume, no --session-id', () => {
    const { args } = claude.buildChatArgs({ ...base, resumeSessionId: 'sess-abc' });
    expect(args[1]).toContain("--resume 'sess-abc'");
    expect(args[1]).not.toContain('--session-id');
  });

  it('mcpConfigPath adds --mcp-config + --strict-mcp-config (pins the turn-scoped server)', () => {
    const { args } = claude.buildChatArgs({ ...base, mcpConfigPath: '/tmp/mcp.json' });
    expect(args[1]).toContain(`--mcp-config '/tmp/mcp.json'`);
    expect(args[1]).toContain('--strict-mcp-config');
  });

  it('omits --strict-mcp-config when there is no mcpConfigPath', () => {
    const { args } = claude.buildChatArgs({ ...base });
    expect(args[1]).not.toContain('--strict-mcp-config');
  });

  it('escapes a model containing a shell metacharacter — no unescaped breakout', () => {
    const { args } = claude.buildChatArgs({ ...base, model: 'evil; reboot' });
    expect(args[1]).not.toContain('--model evil; reboot');
    expect(args[1]).toContain(`--model 'evil; reboot'`);
  });

  it('escapes a promptFile containing a shell metacharacter — no unescaped breakout', () => {
    const evilPath = "/tmp/evil'; rm -rf ~/turn.md";
    const { args } = claude.buildChatArgs({ ...base, promptFile: evilPath, sessionId: 'sess-1' });
    // The dangerous substring must never appear bare (unescaped) in argv —
    // escapeForBash closes/escapes/reopens the quote around any embedded `'`.
    expect(args[1]).not.toContain(`< '${evilPath}'`);
    expect(args[1]).toContain(`< '/tmp/evil'"'"'; rm -rf ~/turn.md'`);
  });

  it('escapes resumeSessionId/sessionId/mcpConfigPath containing shell metacharacters', () => {
    const evil = "sess'; rm -rf ~;";
    const { args: resumeArgs } = claude.buildChatArgs({ ...base, resumeSessionId: evil });
    expect(resumeArgs[1]).not.toContain(`--resume ${evil}`);
    expect(resumeArgs[1]).toContain(`--resume 'sess'"'"'; rm -rf ~;'`);

    const { args: sessionArgs } = claude.buildChatArgs({ ...base, sessionId: evil });
    expect(sessionArgs[1]).not.toContain(`--session-id ${evil}`);
    expect(sessionArgs[1]).toContain(`--session-id 'sess'"'"'; rm -rf ~;'`);

    const { args: mcpArgs } = claude.buildChatArgs({
      ...base,
      sessionId: 'sess-1',
      mcpConfigPath: "/tmp/evil'; rm -rf ~/mcp.json",
    });
    expect(mcpArgs[1]).toContain(`--mcp-config '/tmp/evil'"'"'; rm -rf ~/mcp.json'`);
  });
});

describe('claude.extractSessionId', () => {
  it('reads session_id from the stream-json init event', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-9',
      model: 'claude-sonnet-4-6',
    });
    expect(claude.extractSessionId(line)).toBe('sess-9');
  });

  it('returns null for other events, non-JSON, and blanks', () => {
    expect(claude.extractSessionId(JSON.stringify({ type: 'assistant' }))).toBeNull();
    expect(claude.extractSessionId('not json')).toBeNull();
    expect(claude.extractSessionId('')).toBeNull();
  });

  it('returns null when session_id contains a shell metacharacter', () => {
    const withCommandSub = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: '$(reboot)',
    });
    const withSemicolon = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc;def',
    });
    expect(claude.extractSessionId(withCommandSub)).toBeNull();
    expect(claude.extractSessionId(withSemicolon)).toBeNull();
  });
});

describe('claude.detectResumeFailure', () => {
  it('matches the prose marker on either stream, case-insensitive', () => {
    expect(claude.detectResumeFailure('', 'No conversation found with session ID: sess-1')).toBe(
      true,
    );
    expect(claude.detectResumeFailure('no conversation found with session id sess-1', '')).toBe(
      true,
    );
  });

  it('matches a structured error result with zero turns', () => {
    const line = JSON.stringify({ type: 'result', is_error: true, num_turns: 0 });
    expect(claude.detectResumeFailure(line, '')).toBe(true);
  });

  it('does not fire on a healthy run or a mid-run error', () => {
    const ok = JSON.stringify({ type: 'result', is_error: false, num_turns: 3 });
    const midErr = JSON.stringify({ type: 'result', is_error: true, num_turns: 2 });
    expect(claude.detectResumeFailure(ok, '')).toBe(false);
    expect(claude.detectResumeFailure(midErr, '')).toBe(false);
  });
});

describe('codex chat surface', () => {
  it('fresh turn uses exec --json with quiet env', () => {
    const { cmd, args, env } = codex.buildChatArgs({ ...base, model: 'gpt-5.5' });
    expect(cmd).toBe('/bin/bash');
    expect(args[1]).toContain('codex exec --json');
    expect(args[1]).toContain('--sandbox read-only');
    expect(args[1]).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args[1]).toContain("--model 'gpt-5.5'");
    expect(args[1]).toContain(`"$(cat '/tmp/turn.md')"`);
    expect(env).toEqual({ CODEX_QUIET_MODE: '1' });
  });

  it('throws when asked to resume (probe gates this off)', () => {
    expect(() => codex.buildChatArgs({ ...base, model: 'gpt-5.5', resumeSessionId: 'x' })).toThrow(
      /resume/i,
    );
  });

  it('no session extraction or resume-failure detection yet', () => {
    expect(codex.extractSessionId('{"type":"thread.started","thread_id":"t1"}')).toBeNull();
    expect(codex.detectResumeFailure('anything', 'anything')).toBe(false);
  });

  it('escapes a promptFile containing a shell metacharacter — no unescaped breakout', () => {
    const evilPath = "/tmp/evil'; rm -rf ~/turn.md";
    const { args } = codex.buildChatArgs({ ...base, model: 'gpt-5.5', promptFile: evilPath });
    expect(args[1]).not.toContain(`cat '${evilPath}'`);
    expect(args[1]).toContain(`cat '/tmp/evil'"'"'; rm -rf ~/turn.md'`);
  });

  it('escapes a model containing a shell metacharacter', () => {
    const evilModel = "gpt-5.5'; rm -rf ~;";
    const { args } = codex.buildChatArgs({ ...base, model: evilModel });
    expect(args[1]).not.toContain(`--model ${evilModel}`);
    expect(args[1]).toContain(`--model 'gpt-5.5'"'"'; rm -rf ~;'`);
  });

  it('turn-scoped MCP: injects the turn id + app url into the sur9e-app server via -c overrides', () => {
    const mcpConfigPath = writeMcpConfigForTurn('/repo/root', {
      turnId: 'turn-codex-1',
      appUrl: 'http://localhost:3000',
    });
    const { args } = codex.buildChatArgs({ ...base, model: 'gpt-5.5', mcpConfigPath });
    const line = args[1];
    // The turn id in the sur9e-app server env is what makes the action routes
    // emit a confirm card (x-sur9e-turn header) instead of terminal fallback.
    expect(line).toContain(`-c 'mcp_servers.sur9e-app.env.SUR9E_CHAT_TURN_ID="turn-codex-1"'`);
    expect(line).toContain(`-c 'mcp_servers.sur9e-app.env.SUR9E_APP_URL="http://localhost:3000"'`);
    unlinkSync(mcpConfigPath);
  });

  it('omits the turn-scoped MCP env overrides when no mcpConfigPath (terminal/legacy path)', () => {
    const { args } = codex.buildChatArgs({ ...base, model: 'gpt-5.5' });
    // Without a per-turn MCP config there is no turn id / app url to inject, so
    // the turn-scoped `.env.` overrides must be absent — a turn-less call must
    // never leak a stale SUR9E_CHAT_TURN_ID into the sur9e-app server env.
    expect(args[1]).not.toContain('mcp_servers.sur9e-app.env.');
    // The approval-mode override is NOT turn-scoped: the sur9e-app server is
    // registered by the project .codex/config.toml (cwd=repo-root every turn),
    // so its tools need pre-approval to run under the sandbox even on a
    // turn-less call — hence it stays in the always-on base args.
    expect(args[1]).toContain('mcp_servers.sur9e-app.default_tools_approval_mode');
  });
});

describe('opencode chat surface', () => {
  it('fresh turn uses run --pure --format json -m and points OPENCODE_CONFIG at a read-only temp config', () => {
    const { args, env } = opencode.buildChatArgs({ ...base, model: 'anthropic/claude-3-haiku' });
    // --format json streams structured parts (thinking/tool/text) so the chat
    // transcript can render thinking blocks + tool chips; --thinking opts the
    // reasoning parts into the stream.
    expect(args[1]).toContain('opencode run --pure --format json --thinking');
    expect(args[1]).toContain("-m 'anthropic/claude-3-haiku'");
    expect(args[1]).toContain(`"$(cat '/tmp/turn.md')"`);
    // No inline --config flag on the command line — opencode's per-invocation
    // config mechanism is the OPENCODE_CONFIG env var (confirmed against
    // opencode.ai/docs/config), not a CLI flag.
    expect(args[1]).not.toContain('--config');

    expect(env?.OPENCODE_CONFIG).toBeTruthy();
    const configPath = env?.OPENCODE_CONFIG as string;
    expect(configPath).toMatch(/sur9e-chat-readonly-.*\.json$/);

    // Read back what buildChatArgs actually wrote to disk and assert the
    // config denies write/edit/bash (via the "edit" + "bash" permission
    // keys) while still allowing the read-only tool set.
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.permission.edit).toBe('deny'); // covers edit + write + apply_patch
    expect(written.permission.bash).toBe('deny');
    expect(written.permission.task).toBe('deny');
    expect(written.permission.read).toBe('allow');
    expect(written.permission.grep).toBe('allow');
    expect(written.permission.glob).toBe('allow');
    expect(written.permission.webfetch).toBe('allow');

    unlinkSync(configPath);
  });

  it('throws when asked to resume (probe gates this off)', () => {
    expect(() => opencode.buildChatArgs({ ...base, model: 'x/y', resumeSessionId: 'x' })).toThrow(
      /resume/i,
    );
  });

  it('no session extraction or resume-failure detection yet', () => {
    expect(opencode.extractSessionId('any line')).toBeNull();
    expect(opencode.detectResumeFailure('a', 'b')).toBe(false);
  });

  it('escapes a promptFile containing a shell metacharacter — no unescaped breakout', () => {
    const evilPath = "/tmp/evil'; rm -rf ~/turn.md";
    const { args, env } = opencode.buildChatArgs({ ...base, model: 'x/y', promptFile: evilPath });
    expect(args[1]).not.toContain(`cat '${evilPath}'`);
    expect(args[1]).toContain(`cat '/tmp/evil'"'"'; rm -rf ~/turn.md'`);
    if (env?.OPENCODE_CONFIG) unlinkSync(env.OPENCODE_CONFIG);
  });

  it('escapes a model containing a shell metacharacter', () => {
    const evilModel = "x/y'; rm -rf ~;";
    const { args, env } = opencode.buildChatArgs({ ...base, model: evilModel });
    expect(args[1]).not.toContain(`-m ${evilModel}`);
    expect(args[1]).toContain(`-m 'x/y'"'"'; rm -rf ~;'`);
    if (env?.OPENCODE_CONFIG) unlinkSync(env.OPENCODE_CONFIG);
  });

  it('turn-scoped MCP: registers sur9e-app with the turn id in the OPENCODE_CONFIG mcp block', () => {
    const mcpConfigPath = writeMcpConfigForTurn('/repo/root', {
      turnId: 'turn-oc-1',
      appUrl: 'http://localhost:3000',
    });
    const { env } = opencode.buildChatArgs({
      ...base,
      model: 'anthropic/claude-3-haiku',
      mcpConfigPath,
    });
    const configPath = env?.OPENCODE_CONFIG as string;
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));

    // A complete local MCP server block (opencode schema-validates each file's
    // mcp.<name> independently, so it must carry type/command/enabled).
    const server = written.mcp['sur9e-app'];
    expect(server.type).toBe('local');
    expect(server.enabled).toBe(true);
    expect(server.command).toEqual(['node', join('/repo/root', 'cli/mcp-app-server.mjs')]);
    // The turn id in the server env is what makes the action routes emit a
    // confirm card (x-sur9e-turn header) instead of terminal fallback.
    expect(server.environment.SUR9E_CHAT_TURN_ID).toBe('turn-oc-1');
    expect(server.environment.SUR9E_APP_URL).toBe('http://localhost:3000');
    // The read-only permission block is preserved alongside the mcp block.
    expect(written.permission.edit).toBe('deny');
    expect(written.permission.bash).toBe('deny');

    unlinkSync(configPath);
    unlinkSync(mcpConfigPath);
  });

  it('omits the mcp block when no mcpConfigPath (terminal/legacy path)', () => {
    const { env } = opencode.buildChatArgs({ ...base, model: 'x/y' });
    const configPath = env?.OPENCODE_CONFIG as string;
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcp).toBeUndefined();
    // Read-only permission block still written on the legacy path.
    expect(written.permission.edit).toBe('deny');
    unlinkSync(configPath);
  });
});
