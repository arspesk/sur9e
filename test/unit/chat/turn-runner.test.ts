import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeChatDb } from '@/lib/server/chat/db';
import * as promptModule from '@/lib/server/chat/prompt';
import {
  appendMessage,
  createConversation,
  getAgentSession,
  listMessages,
  saveAgentSession,
} from '@/lib/server/chat/store';
import { _setTitleExecImpl } from '@/lib/server/chat/titler';
import {
  _setProbeImpl,
  _setSpawnImpl,
  cancelTurn,
  cancelTurnAndWait,
  getTurn,
  mapChatLine,
  startTurn,
  subscribeTurn,
} from '@/lib/server/chat/turn-runner';
import claude from '@/lib/server/providers/claude';
import codex from '@/lib/server/providers/codex';
import { humanizeProviderError } from '@/lib/server/providers/humanize-error';
import opencode from '@/lib/server/providers/opencode';

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(script?: (child: FakeChild) => void): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  if (script) setImmediate(() => script(child));
  return child;
}

const initLine = (sid: string) =>
  JSON.stringify({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-sonnet-4-6' });
const textLine = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const resultLine = (text: string) =>
  JSON.stringify({
    type: 'result',
    result: text,
    is_error: false,
    num_turns: 1,
    total_cost_usd: 0.01,
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 10, output_tokens: 5 },
  });

function happyStream(child: FakeChild, sid: string, text: string): void {
  child.stdout.emit(
    'data',
    Buffer.from(`${initLine(sid)}\n${textLine(text)}\n${resultLine(text)}\n`),
  );
  child.emit('close', 0);
}

function waitForTerminal(turnId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('turn never settled')), 2000);
    const unsub = subscribeTurn(
      turnId,
      e => {
        if (e.type === 'done' || e.type === 'error') {
          clearTimeout(timer);
          unsub?.();
          resolve();
        }
      },
      0,
    );
    if (!unsub) {
      clearTimeout(timer);
      reject(new Error('unknown turn'));
    }
  });
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-turn-'));
  _setProbeImpl(async () => ({ resume: true }));
  // Completed first turns fire-and-forget the AI titler — neutralize its
  // exec so no real provider CLI is ever spawned from a unit test.
  _setTitleExecImpl(async () => ({ stdout: '' })); // empty → sanitize rejects → no write
});

afterEach(() => {
  _setSpawnImpl(null);
  _setProbeImpl(null);
  _setTitleExecImpl(null);
  closeChatDb(root);
  rmSync(root, { recursive: true, force: true });
});

describe('mapChatLine', () => {
  it('claude assistant text → full-length text-delta, no stage duplicate', () => {
    const long = 'A'.repeat(500); // parseStreamLine truncates at 200 — we must not
    const mapped = mapChatLine(claude, textLine(long));
    expect(mapped.text).toBe(long);
    expect(mapped.events.some(e => e.type === 'text-delta')).toBe(true);
    expect(mapped.events.some(e => e.type === 'stage')).toBe(false);
  });

  it('claude result → usage with cost + resultText, never a text-delta', () => {
    const mapped = mapChatLine(claude, resultLine('final text'));
    expect(mapped.resultText).toBe('final text');
    expect(mapped.usage).toEqual({
      costUsd: 0.01,
      inputTokens: 10,
      outputTokens: 5,
      model: 'claude-sonnet-4-6',
    });
    expect(mapped.events.some(e => e.type === 'text-delta')).toBe(false);
  });

  it('claude tool_use → tool event with name/detail', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'WebFetch', input: { url: 'https://x.dev' } }],
      },
    });
    const mapped = mapChatLine(claude, line);
    expect(mapped.events[0]).toEqual({
      type: 'tool',
      name: 'WebFetch',
      detail: 'https://x.dev',
      status: 'start',
    });
  });

  it('claude init → no stage event (infra handshake is not transcript content)', () => {
    const mapped = mapChatLine(claude, initLine('s'));
    expect(mapped.events.some(e => e.type === 'stage')).toBe(false);
  });

  it('claude tool_result → tool DONE event carrying the tool_use_id', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_7', is_error: false }] },
    });
    const mapped = mapChatLine(claude, line);
    expect(mapped.events).toContainEqual({ type: 'tool', name: '', status: 'done', id: 'toolu_7' });
  });

  it('codex agent_message → full reply text-delta (item.text, not message/content)', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'a1', type: 'agent_message', text: 'Here is the answer.' },
    });
    const mapped = mapChatLine(codex, line);
    expect(mapped.text).toBe('Here is the answer.');
    expect(mapped.events.some(e => e.type === 'text-delta')).toBe(true);
    // agent_message maps to a unified 'stage' but the reply text already
    // captured it — so no duplicate stage leaks.
    expect(mapped.events.some(e => e.type === 'stage')).toBe(false);
  });

  it('codex command_execution → paired tool start/done events with the item id', () => {
    const start = mapChatLine(
      codex,
      JSON.stringify({
        type: 'item.started',
        item: { id: 'c9', type: 'command_execution', command: 'ls', status: 'in_progress' },
      }),
    );
    const done = mapChatLine(
      codex,
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'c9',
          type: 'command_execution',
          command: 'ls',
          exit_code: 0,
          status: 'completed',
        },
      }),
    );
    expect(start.events).toContainEqual(
      expect.objectContaining({ type: 'tool', status: 'start', id: 'c9' }),
    );
    expect(done.events).toContainEqual(
      expect.objectContaining({ type: 'tool', status: 'done', id: 'c9' }),
    );
  });

  it('opencode text part → reply text-delta; reasoning → thinking', () => {
    const text = mapChatLine(
      opencode,
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'hello world' } }),
    );
    expect(text.text).toBe('hello world');
    expect(text.events.some(e => e.type === 'text-delta')).toBe(true);
    const think = mapChatLine(
      opencode,
      JSON.stringify({ type: 'reasoning', part: { type: 'reasoning', text: 'pondering' } }),
    );
    expect(think.events).toContainEqual({ type: 'thinking', text: 'pondering' });
  });
});

/** The terminal 'error' event a settled turn emitted (message + optional category). */
function errorEvent(turnId: string): { message: string; category?: string } {
  const turn = getTurn(turnId);
  const ev = turn?.events.find(e => e.type === 'error');
  if (!ev || ev.type !== 'error') throw new Error('no error event on turn');
  return { message: ev.message, category: ev.category };
}

const ESC_RE = /\x1b/;

describe('humanizeProviderError', () => {
  it('a raw stderr dump becomes a clean one-liner (no ANSI, not the verbatim stderr)', () => {
    const rawDump =
      '\x1b[31mError:\x1b[0m at Object.<anonymous> (/opt/app/index.js:42:13)\n' +
      '    at Module._compile (node:internal/modules/cjs/loader:1234:14)\n' +
      '<<<SUR9E_OUTPUT>>> leaked sentinel <<<SUR9E_END>>>';
    const { message, category } = humanizeProviderError('claude', {
      stderr: rawDump,
      code: 1,
    });
    expect(category).toBe('unknown');
    expect(message).not.toBe(rawDump);
    expect(message).not.toMatch(ESC_RE); // no terminal escape bytes
    expect(message).not.toContain('SUR9E'); // no sentinel leak
    expect(message).not.toContain('loader:1234'); // no stack-trace leak
    expect(message).toContain('Claude'); // friendly provider label
  });

  it('an auth-signature stderr → the auth message + category', () => {
    const { message, category } = humanizeProviderError('claude', {
      stderr: 'API Error: 401 {"type":"authentication_error","message":"invalid x-api-key"}',
      code: 1,
    });
    expect(category).toBe('auth');
    expect(message).toBe("Your Claude credentials aren't working — check the API key in Settings.");
  });

  it('a spawn ENOENT → a friendly install message', () => {
    const { message, category } = humanizeProviderError('claude', {
      stderr: 'spawn claude ENOENT',
    });
    expect(category).toBe('install');
    expect(message).toContain('Claude');
    expect(message).not.toContain('ENOENT');
    expect(message).not.toContain('spawn');
  });

  it('rate-limit and context-overflow map to distinct actionable lines', () => {
    const rl = humanizeProviderError('claude', {
      stderr: 'rate_limit_error: 429 too many requests',
    });
    expect(rl.category).toBe('rate_limit');
    expect(rl.message).toContain('rate limit or quota');

    const ctx = humanizeProviderError('claude', { stderr: 'prompt is too long: 250000 tokens' });
    expect(ctx.category).toBe('context_overflow');
    expect(ctx.message).toContain('too long for the model');
  });

  it('an unknown provider id degrades gracefully rather than interpolating a bad label', () => {
    const { message } = humanizeProviderError('made-up', { stderr: 'kaboom', code: 1 });
    expect(message).toContain('the AI provider');
    expect(message).not.toContain('undefined');
  });
});

describe('startTurn', () => {
  it('fresh turn: streams deltas, persists the reply, saves the session handle', async () => {
    const calls: string[][] = [];
    _setSpawnImpl((cmd, args) => {
      calls.push([cmd, ...args]);
      return fakeChild(c => happyStream(c, 'sess-1', 'Hello there.')) as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(turnId);

    const turn = getTurn(turnId);
    expect(turn?.status).toBe('done');
    const types = turn!.events.map(e => e.type);
    expect(types).toContain('text-delta');
    expect(types).toContain('usage');
    expect(types[types.length - 1]).toBe('done');
    const usageEv = turn!.events.find(e => e.type === 'usage');
    expect(usageEv && usageEv.type === 'usage' && usageEv.costUsd).toBe(0.01);

    const cmdline = calls[0].join(' ');
    expect(cmdline).toContain('--session-id');
    expect(cmdline).not.toContain('--resume');

    const msgs = listMessages(root, conv.id);
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1].content).toBe('Hello there.');

    const handle = getAgentSession(root, conv.id, 'claude');
    expect(handle?.providerSessionId).toBe('sess-1');
    expect(handle?.lastMessageId).toBe(msgs[1].id);
    expect(handle?.cwd).toBe(root);
  });

  it('second turn resumes with --resume and sends only the new message', async () => {
    const calls: string[][] = [];
    const prompts: string[] = [];
    _setSpawnImpl((cmd, args) => {
      calls.push([cmd, ...args]);
      const m = args.join(' ').match(/< '([^']+)'/);
      if (m) prompts.push(readFileSync(m[1], 'utf-8'));
      return fakeChild(c => happyStream(c, 'sess-1', 'reply')) as never;
    });
    const conv = createConversation(root);
    const t1 = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(t1.turnId);
    const t2 = await startTurn(root, { conversationId: conv.id, userMessage: 'what did I say?' });
    await waitForTerminal(t2.turnId);

    expect(calls).toHaveLength(2);
    // claude.ts's buildChatArgs routes resumeSessionId through escapeForBash
    // (single-quoted) as defense-in-depth (commit 7d80bcbc) — assert the
    // actual escaped shape rather than a bare substring.
    expect(calls[1].join(' ')).toContain("--resume 'sess-1'");
    expect(calls[1].join(' ')).not.toContain('--session-id');
    expect(prompts[1]).toBe('what did I say?');
  });

  it('guard rejection (model changed) → fresh spawn with full transcript', async () => {
    const calls: string[][] = [];
    const prompts: string[] = [];
    _setSpawnImpl((cmd, args) => {
      calls.push([cmd, ...args]);
      const m = args.join(' ').match(/< '([^']+)'/);
      if (m) prompts.push(readFileSync(m[1], 'utf-8'));
      return fakeChild(c => happyStream(c, 'sess-2', 'ok')) as never;
    });
    const conv = createConversation(root);
    appendMessage(root, { conversationId: conv.id, role: 'user', content: 'earlier question' });
    const a = appendMessage(root, {
      conversationId: conv.id,
      role: 'assistant',
      content: 'earlier answer',
    });
    saveAgentSession(root, {
      conversationId: conv.id,
      provider: 'claude',
      providerSessionId: 'sess-old',
      model: 'some-other-model', // ≠ resolved model → model_changed
      cwd: root,
      lastMessageId: a.id,
    });
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'new q' });
    await waitForTerminal(turnId);

    expect(calls[0].join(' ')).toContain('--session-id');
    expect(calls[0].join(' ')).not.toContain('--resume');
    expect(prompts[0]).toContain('Never auto-submit'); // system prompt present
    expect(prompts[0]).toContain('User: earlier question'); // transcript present
    expect(prompts[0]).toContain('User: new q');
  });

  it('resume failure → clears the handle and reseeds exactly once', async () => {
    const calls: string[][] = [];
    _setSpawnImpl((cmd, args) => {
      calls.push([cmd, ...args]);
      if (calls.length === 1) {
        return fakeChild(c => {
          c.stderr.emit('data', Buffer.from('No conversation found with session ID: sess-1\n'));
          c.emit('close', 1);
        }) as never;
      }
      return fakeChild(c => happyStream(c, 'sess-2', 'reseeded reply')) as never;
    });
    const conv = createConversation(root);
    const first = appendMessage(root, { conversationId: conv.id, role: 'user', content: 'hi' });
    void first;
    const a = appendMessage(root, { conversationId: conv.id, role: 'assistant', content: 'yo' });
    saveAgentSession(root, {
      conversationId: conv.id,
      provider: 'claude',
      providerSessionId: 'sess-1',
      model: 'claude-sonnet-4-6', // matches the temp-root fallback resolution
      cwd: root,
      lastMessageId: a.id,
    });
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'again' });
    await waitForTerminal(turnId);

    expect(calls).toHaveLength(2);
    // Escaped shape — see the note in the "second turn resumes" test above.
    expect(calls[0].join(' ')).toContain("--resume 'sess-1'");
    expect(calls[1].join(' ')).toContain('--session-id');
    expect(calls[1].join(' ')).not.toContain('--resume');
    expect(getTurn(turnId)?.status).toBe('done');
    expect(getAgentSession(root, conv.id, 'claude')?.providerSessionId).toBe('sess-2');
    const msgs = listMessages(root, conv.id);
    expect(msgs[msgs.length - 1].content).toBe('reseeded reply');
  });

  it('startTurn throws for an unknown conversation', async () => {
    await expect(startTurn(root, { conversationId: 'missing', userMessage: 'x' })).rejects.toThrow(
      /conversation not found/,
    );
  });

  it('double resume failure → reseeds once, then falls through to a single terminal error (no loop)', async () => {
    const calls: string[][] = [];
    _setSpawnImpl((cmd, args) => {
      calls.push([cmd, ...args]);
      // Every spawn — original AND reseed — fails resume the same way.
      return fakeChild(c => {
        c.stderr.emit('data', Buffer.from('No conversation found with session ID: sess-1\n'));
        c.emit('close', 1);
      }) as never;
    });
    const conv = createConversation(root);
    appendMessage(root, { conversationId: conv.id, role: 'user', content: 'hi' });
    const a = appendMessage(root, { conversationId: conv.id, role: 'assistant', content: 'yo' });
    saveAgentSession(root, {
      conversationId: conv.id,
      provider: 'claude',
      providerSessionId: 'sess-1',
      model: 'claude-sonnet-4-6', // matches the temp-root fallback resolution
      cwd: root,
      lastMessageId: a.id,
    });
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'again' });
    await waitForTerminal(turnId);

    // Original attempt + exactly one reseed — the isResuming:false the
    // reseed sets means the guard (isResuming && !isReseed) can't fire
    // again, so a second resume failure must NOT trigger a second reseed.
    expect(calls).toHaveLength(2);
    expect(calls[0].join(' ')).toContain("--resume 'sess-1'");
    expect(calls[1].join(' ')).toContain('--session-id'); // reseed = fresh session

    const turn = getTurn(turnId);
    expect(turn?.status).toBe('error');
    const errorEvents = turn!.events.filter(e => e.type === 'error');
    expect(errorEvents).toHaveLength(1); // single terminal error, not doubled
  });

  it('reseed prologue throw (buildTurnPrompt failure) → single terminal error, lock released, no wedge', async () => {
    // Regression test: runAttempt's prologue (buildTurnPrompt + writeFileSync)
    // used to be unprotected by any try/catch. The initial call is safe by
    // accident — it runs inside startTurn's own try/catch — but the RESEED
    // call fires from inside the child 'close' handler, which has no
    // surrounding try/catch of its own. An uncaught prologue throw there used
    // to escape entirely: finishError never ran, and the conversation's
    // in-flight lock stayed held forever. Inject the throw via buildTurnPrompt
    // — succeed (delegating to the real implementation) on the 1st (initial)
    // call, throw on the 2nd (reseed). (vi.mock('node:fs', …) was tried first
    // but this project's own test suite already documents that mocking
    // Node built-ins via the `node:` prefix is flaky here — see the comment
    // atop src/lib/server/providers/__tests__/claude.test.ts — so this spies
    // on the first-party prompt module instead, which Vitest can redefine.)
    const realBuildTurnPrompt = promptModule.buildTurnPrompt;
    let promptCalls = 0;
    const promptSpy = vi.spyOn(promptModule, 'buildTurnPrompt').mockImplementation(args => {
      promptCalls += 1;
      if (promptCalls === 2) {
        throw new Error('ENOENT: a file buildTurnPrompt reads went missing mid-turn');
      }
      return realBuildTurnPrompt(args);
    });

    const calls: string[][] = [];
    _setSpawnImpl((cmd, args) => {
      calls.push([cmd, ...args]);
      // Only the INITIAL attempt should ever reach spawnImpl — the reseed's
      // prologue throw must short-circuit before a second spawn.
      return fakeChild(c => {
        c.stderr.emit('data', Buffer.from('No conversation found with session ID: sess-1\n'));
        c.emit('close', 1);
      }) as never;
    });
    const conv = createConversation(root);
    appendMessage(root, { conversationId: conv.id, role: 'user', content: 'hi' });
    const a = appendMessage(root, { conversationId: conv.id, role: 'assistant', content: 'yo' });
    saveAgentSession(root, {
      conversationId: conv.id,
      provider: 'claude',
      providerSessionId: 'sess-1',
      model: 'claude-sonnet-4-6', // matches the temp-root fallback resolution
      cwd: root,
      lastMessageId: a.id,
    });

    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'again' });
    await waitForTerminal(turnId);
    promptSpy.mockRestore(); // done injecting — subsequent calls in this test must use the real impl

    // (a) single terminal error event — finishError fired exactly once.
    const turn = getTurn(turnId);
    expect(turn?.status).toBe('error');
    const errorEvents = turn!.events.filter(e => e.type === 'error');
    expect(errorEvents).toHaveLength(1);

    // The reseed's prologue throw short-circuited before ever reaching
    // spawnImpl a second time.
    expect(calls).toHaveLength(1);

    // (b) lock released, no wedge, no loop — a subsequent startTurn for the
    // SAME conversation is allowed rather than rejected with "already
    // running". Without the fix this either hangs (lock never released) or
    // never gets here at all (the prologue throw crashes the close handler).
    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-2', 'unwedged')) as never);
    const t2 = await startTurn(root, { conversationId: conv.id, userMessage: 'again, unwedged' });
    await waitForTerminal(t2.turnId);
    expect(getTurn(t2.turnId)?.status).toBe('done');
  });

  it('FR-4: an invalid pinned provider/model throws before persisting the user message, and releases the lock', async () => {
    const conv = createConversation(root);

    // ProviderId.parse throws synchronously on a bad pinned provider — this
    // must happen BEFORE appendMessage commits the user message row, or a
    // retry double-appends and the orphaned bubble pollutes the next reseed
    // transcript.
    await expect(
      startTurn(root, {
        conversationId: conv.id,
        userMessage: 'hello',
        provider: 'not-a-real-provider',
        model: 'whatever',
      }),
    ).rejects.toThrow();

    // No orphan user message — resolution failed before appendMessage ran.
    expect(listMessages(root, conv.id)).toHaveLength(0);

    // Lock released — a subsequent valid startTurn on the same conversation
    // is allowed, not rejected with "already running".
    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-1', 'ok')) as never);
    const { turnId } = await startTurn(root, {
      conversationId: conv.id,
      userMessage: 'hello again',
    });
    await waitForTerminal(turnId);
    expect(getTurn(turnId)?.status).toBe('done');
    expect(listMessages(root, conv.id).map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('wires a per-turn MCP config into buildChatArgs and cleans it up after the turn ends', async () => {
    const calls: string[][] = [];
    _setSpawnImpl((cmd, args) => {
      calls.push([cmd, ...args]);
      return fakeChild(c => happyStream(c, 'sess-1', 'ok')) as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(turnId);

    const cmdline = calls[0].join(' ');
    const m = cmdline.match(/--mcp-config '([^']+)'/);
    expect(m).not.toBeNull();
    const mcpConfigPath = m![1];
    expect(mcpConfigPath.startsWith(join(tmpdir(), 'sur9e-mcp'))).toBe(true);

    // The config file existed while the turn was running (spawnImpl above
    // captured the path from the ALREADY-WRITTEN args) — now that the turn
    // has settled, the turn runner's cleanup must have removed it, exactly
    // like the temp prompt file.
    expect(existsSync(mcpConfigPath)).toBe(false);
  });

  it('a throwing probe still lets the turn proceed via the resend path', async () => {
    _setProbeImpl(async () => {
      throw new Error('probe blew up');
    });
    const calls: string[][] = [];
    _setSpawnImpl((cmd, args) => {
      calls.push([cmd, ...args]);
      return fakeChild(c => happyStream(c, 'sess-1', 'ok despite probe failure')) as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(turnId);

    expect(getTurn(turnId)?.status).toBe('done');
    // Probe failure degrades to { resume: false } → always the fresh/resend
    // path, never --resume.
    expect(calls[0].join(' ')).toContain('--session-id');
    expect(calls[0].join(' ')).not.toContain('--resume');
  });

  it('non-zero exit: humanizes the raw stderr instead of surfacing its tail', async () => {
    // A noisy, multi-line stderr whose LAST line (what the old code showed) is
    // an unactionable stack frame — plus ANSI noise and a leaked sentinel.
    const noisyStderr =
      '\x1b[31mFATAL\x1b[0m unexpected token\n<<<SUR9E_OUTPUT>>>\n    at wrap (node:internal/x:9:1)';
    _setSpawnImpl(
      () =>
        fakeChild(c => {
          c.stderr.emit('data', Buffer.from(`${noisyStderr}\n`));
          c.emit('close', 1);
        }) as never,
    );
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hi' });
    await waitForTerminal(turnId);

    expect(getTurn(turnId)?.status).toBe('error');
    const { message, category } = errorEvent(turnId);
    expect(category).toBe('unknown');
    expect(message).toBe("Claude couldn't complete this reply — try again or switch model.");
    // Crucially: NOT the raw stderr tail the old code showed.
    expect(message).not.toContain('at wrap');
    expect(message).not.toMatch(ESC_RE);
    expect(message).not.toContain('SUR9E');
  });

  it('non-zero exit with an auth signature → the auth message + category flows onto the event', async () => {
    _setSpawnImpl(
      () =>
        fakeChild(c => {
          c.stderr.emit(
            'data',
            Buffer.from('API Error: {"type":"authentication_error","message":"revoked"}\n'),
          );
          c.emit('close', 1);
        }) as never,
    );
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hi' });
    await waitForTerminal(turnId);

    const { message, category } = errorEvent(turnId);
    expect(category).toBe('auth');
    expect(message).toBe("Your Claude credentials aren't working — check the API key in Settings.");
  });

  it('exit 0 with empty output → a clean empty-reply error, not an empty bubble', async () => {
    // init + a result event whose text is empty, no assistant text at all.
    _setSpawnImpl(
      () =>
        fakeChild(c => {
          c.stdout.emit('data', Buffer.from(`${initLine('sess-1')}\n${resultLine('')}\n`));
          c.emit('close', 0);
        }) as never,
    );
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hi' });
    await waitForTerminal(turnId);

    const turn = getTurn(turnId);
    expect(turn?.status).toBe('error');
    expect(errorEvent(turnId).message).toBe('The assistant returned an empty reply — try again.');
    // No 'done' event and no empty assistant row persisted.
    expect(turn!.events.some(e => e.type === 'done')).toBe(false);
    expect(listMessages(root, conv.id).map(m => m.role)).toEqual(['user']);
  });

  it('child spawn error (ENOENT) → a friendly install message, not the bare Node error', async () => {
    _setSpawnImpl(() => fakeChild(c => c.emit('error', new Error('spawn claude ENOENT'))) as never);
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hi' });
    await waitForTerminal(turnId);

    expect(getTurn(turnId)?.status).toBe('error');
    const { message, category } = errorEvent(turnId);
    expect(category).toBe('install');
    expect(message).toBe(
      "Couldn't launch the Claude CLI — make sure it's installed and on your PATH.",
    );
    expect(message).not.toContain('ENOENT');
  });
});

describe('in-flight conversation guard', () => {
  it('a second startTurn for the same conversation throws while the first is still running', async () => {
    let firstChild: FakeChild | null = null;
    _setSpawnImpl(() => {
      // No script → hangs indefinitely, i.e. the first turn stays 'running'
      // until we manually finish it below.
      firstChild = fakeChild();
      return firstChild as never;
    });
    const conv = createConversation(root);
    const { turnId: firstTurnId } = await startTurn(root, {
      conversationId: conv.id,
      userMessage: 'first',
    });
    expect(getTurn(firstTurnId)?.status).toBe('running');

    await expect(
      startTurn(root, { conversationId: conv.id, userMessage: 'second' }),
    ).rejects.toThrow(/already running/i);

    // The first turn is unaffected by the rejected second call — it can
    // still complete normally. Subscribe BEFORE emitting (as every other
    // test in this file does via fakeChild's setImmediate-scheduled script)
    // so the terminal event is delivered live, not replayed synchronously
    // from inside the subscribeTurn() call that's still setting up unsub.
    const done = waitForTerminal(firstTurnId);
    firstChild!.stdout.emit(
      'data',
      Buffer.from(`${initLine('sess-1')}\n${textLine('ok')}\n${resultLine('ok')}\n`),
    );
    firstChild!.emit('close', 0);
    await done;
    expect(getTurn(firstTurnId)?.status).toBe('done');
  });

  it('releases the lock on error, allowing a new startTurn for the same conversation', async () => {
    const calls: string[][] = [];
    _setSpawnImpl((cmd, args) => {
      calls.push([cmd, ...args]);
      if (calls.length === 1) {
        return fakeChild(c => {
          c.stderr.emit('data', Buffer.from('boom\n'));
          c.emit('close', 1);
        }) as never;
      }
      return fakeChild(c => happyStream(c, 'sess-1', 'second reply')) as never;
    });
    const conv = createConversation(root);
    const t1 = await startTurn(root, { conversationId: conv.id, userMessage: 'first' });
    await waitForTerminal(t1.turnId);
    expect(getTurn(t1.turnId)?.status).toBe('error');

    // Lock released on the error path → a new turn for the same
    // conversation is allowed, not rejected.
    const t2 = await startTurn(root, { conversationId: conv.id, userMessage: 'second' });
    await waitForTerminal(t2.turnId);
    expect(getTurn(t2.turnId)?.status).toBe('done');
    expect(calls).toHaveLength(2);
  });
});

describe('cancelTurn', () => {
  it('emits a cancelled error and kills the child', async () => {
    let child: FakeChild | null = null;
    _setSpawnImpl(() => {
      child = fakeChild(); // hangs — never closes on its own
      return child as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });

    expect(cancelTurn(turnId)).toBe(true);
    const turn = getTurn(turnId);
    expect(turn?.status).toBe('error');
    const last = turn!.events[turn!.events.length - 1];
    expect(last.type === 'error' && last.message).toBe('cancelled');
    expect(child!.kill).toHaveBeenCalledWith('SIGTERM');

    child!.emit('close', null); // late close must not resurrect the turn
    expect(getTurn(turnId)?.status).toBe('error');
    expect(cancelTurn(turnId)).toBe(false); // already settled
  });

  it('releases the in-flight lock, allowing a new startTurn for the same conversation', async () => {
    let firstChild: FakeChild | null = null;
    _setSpawnImpl(() => {
      firstChild = fakeChild(); // hangs — never closes on its own
      return firstChild as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    expect(cancelTurn(turnId)).toBe(true);
    firstChild!.emit('close', null);

    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-1', 'after cancel')) as never);
    const t2 = await startTurn(root, { conversationId: conv.id, userMessage: 'again' });
    await waitForTerminal(t2.turnId);
    expect(getTurn(t2.turnId)?.status).toBe('done');
  });

  it('FR-5: does not free the lock (or allow a second spawn) until the cancelled child actually exits', async () => {
    let spawnCount = 0;
    let firstChild: FakeChild | null = null;
    _setSpawnImpl(() => {
      spawnCount += 1;
      firstChild = fakeChild(); // hangs — never closes on its own
      return firstChild as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    expect(cancelTurn(turnId)).toBe(true);
    expect(spawnCount).toBe(1);

    // SIGTERM was requested but the (fake) child hasn't exited yet — the
    // conversation must still read as in-flight: a new startTurn is
    // rejected, and — critically — no second child is spawned while the
    // cancelled one might still be alive (one-process-per-conversation).
    await expect(
      startTurn(root, { conversationId: conv.id, userMessage: 'too soon' }),
    ).rejects.toThrow(/already running/i);
    expect(spawnCount).toBe(1);

    // The cancelled child now truly exits (SIGTERM took effect) — only now
    // does the lock free up, letting a new startTurn spawn exactly one more
    // child.
    firstChild!.emit('close', null);
    _setSpawnImpl(() => {
      spawnCount += 1;
      return fakeChild(c => happyStream(c, 'sess-1', 'after cancel')) as never;
    });
    const t2 = await startTurn(root, { conversationId: conv.id, userMessage: 'now' });
    await waitForTerminal(t2.turnId);
    expect(spawnCount).toBe(2);
    expect(getTurn(t2.turnId)?.status).toBe('done');
  });

  it('persists the streamed partial as an assistant message at cancel time, exactly once', async () => {
    let child: FakeChild | null = null;
    _setSpawnImpl(() => {
      child = fakeChild(c => {
        // Streams init + some text, then hangs — the user hits Stop mid-reply.
        c.stdout.emit(
          'data',
          Buffer.from(`${initLine('sess-1')}\n${textLine('partial answer so far')}\n`),
        );
      });
      return child as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await vi.waitFor(() => {
      expect(getTurn(turnId)!.events.some(e => e.type === 'text-delta')).toBe(true);
    });

    expect(cancelTurn(turnId)).toBe(true);

    // Persisted synchronously at cancel — BEFORE the child exits — so the
    // client's post-cancel refetch provably sees it.
    const afterCancel = listMessages(root, conv.id).filter(m => m.role === 'assistant');
    expect(afterCancel).toHaveLength(1);
    expect(afterCancel[0].content).toBe('partial answer so far');

    // The dying child's close handler must not persist a second copy.
    child!.emit('close', null);
    expect(listMessages(root, conv.id).filter(m => m.role === 'assistant')).toHaveLength(1);
  });

  it('cancelTurnAndWait resolves only after the cancelled child exits, with the lock free', async () => {
    let child: FakeChild | null = null;
    _setSpawnImpl(() => {
      child = fakeChild(); // hangs — SIGTERM takes a while to be honored
      return child as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });

    let settled = false;
    const wait = cancelTurnAndWait(turnId).then(v => {
      settled = true;
      return v;
    });
    // The child hasn't exited — the wait must still be pending (this is what
    // lets "Send now" fire a new turn without bouncing off the FR-5 lock).
    await new Promise(r => setTimeout(r, 150));
    expect(settled).toBe(false);

    child!.emit('close', null);
    await expect(wait).resolves.toBe(true);

    // Lock is provably free: a new startTurn succeeds with no retry.
    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-1', 'next reply')) as never);
    const t2 = await startTurn(root, { conversationId: conv.id, userMessage: 'queued text' });
    await waitForTerminal(t2.turnId);
    expect(getTurn(t2.turnId)?.status).toBe('done');
  });

  it('cancelTurnAndWait returns immediately for an already-settled turn', async () => {
    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-1', 'done already')) as never);
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(turnId);
    await expect(cancelTurnAndWait(turnId)).resolves.toBe(false);
  });

  it('cancel before any streamed output persists no assistant message', async () => {
    let child: FakeChild | null = null;
    _setSpawnImpl(() => {
      child = fakeChild(); // hangs silently — nothing streamed yet
      return child as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    expect(cancelTurn(turnId)).toBe(true);
    child!.emit('close', null);
    expect(listMessages(root, conv.id).filter(m => m.role === 'assistant')).toHaveLength(0);
  });
});

describe('subscribeTurn', () => {
  it('replays only events with seq > afterSeq', async () => {
    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-1', 'hey')) as never);
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(turnId);

    const all: number[] = [];
    subscribeTurn(turnId, e => all.push(e.seq), 0)?.();
    const tail: number[] = [];
    subscribeTurn(turnId, e => tail.push(e.seq), all[1])?.();
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(tail).toEqual(all.slice(2));
    expect(subscribeTurn('nope', () => {}, 0)).toBeNull();
  });
});
