// src/lib/server/chat/turn-runner.ts
//
// The chat turn engine (design spec §3.1/§3.4/§3.6): per-turn spawn of the
// provider CLI, resume-first with the identity guard, one-shot lossless
// reseed on resume failure, stdout mapped to ChatTurnEvents, and an
// in-memory turn registry the SSE route replays from (?after=<seq>).
//
// The registry lives on globalThis (same rationale as chat/db.ts: Turbopack
// route graphs + HMR must share one instance). spawnImpl/probeImpl are
// injectable for tests — the spawn hook copies batch/lib/llm.mjs's pattern.
//
// Spend: chat spawns never pipe through cli/stream-claude-parser.mjs, so no
// [USAGE] marker exists on stdout. The same numbers arrive in-process via
// the provider's terminal stream event; trackProvider is called directly,
// mirroring the close handler in jobs/runner.ts with mode 'chat'.

import 'server-only';
import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentSessionHandle,
  ChatAttachment,
  ChatMessage,
  ChatTurnEvent,
} from '../../schemas/chat';
import { ProviderId } from '../../schemas/providers';
import { probeChatCapabilities } from '../providers/chat-capabilities';
import { humanizeProviderError } from '../providers/humanize-error';
import {
  getProvider,
  type ModeRuntime,
  type RunOverride,
  resolveModeRuntime,
} from '../providers/registry';
import type { Provider, SpawnArgs } from '../providers/types';
import { detectAppUrl, writeMcpConfigForTurn } from './mcp-config';
import { buildTurnPrompt } from './prompt';
import { validateResume } from './resume-guard';
import {
  appendMessage,
  clearAgentSession,
  getAgentSession,
  getConversation,
  listMessages,
  saveAgentSession,
  setMessageVersionGroup,
} from './store';
import { applyFallbackTitle, generateConversationTitle } from './titler';

const TURN_TIMEOUT_MS = 10 * 60 * 1000; // hard SIGKILL ceiling per attempt
const CANCEL_GRACE_MS = 5000; // SIGTERM → SIGKILL escalation on explicit cancel
const TURN_RETENTION_MS = 60 * 60 * 1000; // terminal turns stay replayable for 1h

export type TurnStatus = 'running' | 'done' | 'error';

export type TurnRecord = {
  turnId: string;
  conversationId: string;
  events: ChatTurnEvent[];
  seq: number;
  status: TurnStatus;
  startedAt: number;
  child: ChildProcess | null;
  subscribers: Set<(e: ChatTurnEvent) => void>;
};

/** A ChatTurnEvent minus seq — emitTurnEvent assigns the seq. */
export type ChatTurnEventPayload = {
  [K in ChatTurnEvent['type']]: Omit<Extract<ChatTurnEvent, { type: K }>, 'seq'>;
}[ChatTurnEvent['type']];

// Single-process contract: `turns` and `inFlightConversations` (below) are
// in-memory, process-local state stashed on globalThis only to survive
// Turbopack/HMR module reloads within ONE Node process (e.g. `next start`).
// SSE reattach (subscribeTurn replaying from a turnId) and the per-
// conversation lock both assume a single process holds all of it — a
// clustered/multi-worker deploy would let two workers both believe they own
// a conversation's lock, and a client's SSE reconnect could land on a
// worker that never saw the turn. Not a concern for sur9e's local/self-
// hosted deployment model today, but worth knowing before scaling this out.
const turns: Map<string, TurnRecord> = ((
  globalThis as unknown as { __sur9eChatTurns?: Map<string, TurnRecord> }
).__sur9eChatTurns ??= new Map());

// Per-conversation in-flight guard: at most one turn may run for a given
// conversationId at a time, closing the race where two near-simultaneous
// startTurn() calls both spawn a child and both write the agent-session row
// (last writer wins). A conversationId is added synchronously at the top of
// startTurn (before any await, so the check-and-add can't interleave with
// another call) and removed exactly once the turn TRULY finishes — that
// includes across a reseed's second attempt, which is the same logical turn
// and must keep the lock held the whole way through, AND across an explicit
// cancelTurn, which holds the lock until the cancelled child has actually
// exited rather than the moment SIGTERM was requested (FR-5) — a second
// startTurn spawning a second child while the first is still dying would
// briefly violate the one-process-per-conversation invariant this guard
// exists to enforce. See finishError (all error-terminal branches funnel
// through it, releasing immediately unless told not to) and the success
// branch of runAttempt's close handler for the release points.
const inFlightConversations: Set<string> = ((
  globalThis as unknown as { __sur9eChatInFlight?: Set<string> }
).__sur9eChatInFlight ??= new Set());

type SpawnImpl = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcess;

let spawnImpl: SpawnImpl = nodeSpawn as unknown as SpawnImpl;

/** Test hook — pass null to restore node's spawn. */
export function _setSpawnImpl(impl: SpawnImpl | null): void {
  spawnImpl = impl ?? (nodeSpawn as unknown as SpawnImpl);
}

type ProbeImpl = (provider: Provider) => Promise<{ resume: boolean }>;

let probeImpl: ProbeImpl = probeChatCapabilities;

/** Test hook — pass null to restore the real capability probe. */
export function _setProbeImpl(impl: ProbeImpl | null): void {
  probeImpl = impl ?? probeChatCapabilities;
}

/**
 * Probe chat capabilities, degrading to { resume: false } on any throw. A
 * probe failure (network hiccup, malformed --help output, an injected test
 * double that throws) must never block a turn — the resend path is always
 * safe to fall back to.
 */
async function probeCapsSafe(provider: Provider): Promise<{ resume: boolean }> {
  try {
    return await probeImpl(provider);
  } catch {
    return { resume: false };
  }
}

export function getTurn(turnId: string): TurnRecord | null {
  return turns.get(turnId) ?? null;
}

/**
 * Replay buffered events with seq > afterSeq, then live-subscribe.
 * Returns an unsubscribe function, or null when the turn is unknown.
 * THE SSE ROUTE USES THIS — and the MCP actions plan's confirm flow
 * subscribes the same way.
 */
export function subscribeTurn(
  turnId: string,
  fn: (e: ChatTurnEvent) => void,
  afterSeq = 0,
): (() => void) | null {
  const turn = turns.get(turnId);
  if (!turn) return null;
  for (const e of turn.events) {
    if (e.seq > afterSeq) {
      try {
        fn(e);
      } catch {
        // A broken subscriber must never kill the turn.
      }
    }
  }
  turn.subscribers.add(fn);
  return () => turn.subscribers.delete(fn);
}

/**
 * Append an event to a turn (assigning the next seq) and fan it out to all
 * subscribers. Exported: the MCP actions plan injects 'confirm' / 'ui'
 * events into a running turn through this. Returns the sequenced event, or
 * null when the turn is unknown.
 */
export function emitTurnEvent(turnId: string, event: ChatTurnEventPayload): ChatTurnEvent | null {
  const turn = turns.get(turnId);
  if (!turn) return null;
  const full = { ...event, seq: ++turn.seq } as ChatTurnEvent;
  turn.events.push(full);
  for (const fn of turn.subscribers) {
    try {
      fn(full);
    } catch {
      // A broken subscriber must never kill the turn.
    }
  }
  return full;
}

function finishError(
  turn: TurnRecord,
  message: string,
  opts: {
    releaseLock?: boolean;
    promptFile?: string;
    mcpConfigPath?: string;
    /** classify-error bucket ('auth'|'quota'|…) for a humanized provider failure. */
    category?: string;
  } = {},
): void {
  turn.status = 'error';
  emitTurnEvent(turn.turnId, {
    type: 'error',
    message,
    ...(opts.category ? { category: opts.category } : {}),
  });
  // FR-9: best-effort clean the temp prompt file on every terminal path.
  // The child close/error handlers already unlink it after a successful
  // spawn; this covers the prologue-throw path (e.g. buildChatArgs throwing
  // after writeFileSync already wrote it, but before spawnImpl ever ran) —
  // without this, that file orphans in the OS tmp dir forever. unlink is
  // safe to attempt even when nothing was written (ENOENT) or another path
  // already removed it — swallow and move on either way.
  if (opts.promptFile) {
    try {
      unlinkSync(opts.promptFile);
    } catch {
      // best-effort — never written, or already removed.
    }
  }
  // Same best-effort cleanup for the per-turn MCP config file (mcp-config.ts)
  // — covers the identical prologue-throw window: writeMcpConfigForTurn runs
  // before buildChatArgs, so buildChatArgs throwing leaves the config file
  // written but spawnImpl never ran to reach the close/error handler cleanup.
  if (opts.mcpConfigPath) {
    try {
      unlinkSync(opts.mcpConfigPath);
    } catch {
      // best-effort — never written, or already removed.
    }
  }
  // Every error-terminal branch (buildChatArgs throw, timeout, non-zero
  // exit, spawn error) releases the lock immediately here, since by the
  // time finishError runs on those paths the child has already exited (it
  // was called from that child's own close/error handler). cancelTurn is
  // the one exception (FR-5): it passes releaseLock: false because the
  // child is often still alive at that point — SIGTERM was just sent, not
  // yet honored — so releasing here would let a new startTurn spawn a
  // second child for the same conversation while the cancelled one is
  // still running. cancelTurn's child instead releases the lock from
  // runAttempt's own close/error handler, once the child has truly exited.
  const releaseLock = opts.releaseLock ?? true;
  if (releaseLock) {
    inFlightConversations.delete(turn.conversationId);
  }
}

function pruneTerminalTurns(): void {
  const cutoff = Date.now() - TURN_RETENTION_MS;
  for (const [id, t] of turns) {
    if (t.status !== 'running' && t.startedAt < cutoff) turns.delete(id);
  }
}

export type MappedLine = {
  events: ChatTurnEventPayload[];
  /** Full-fidelity reply text carried by this line (stage summaries are capped at 200 chars). */
  text: string | null;
  /** Authoritative complete reply from the provider's terminal event, when present. */
  resultText: string | null;
  usage: {
    costUsd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    model: string | null;
  } | null;
};

/**
 * Map one raw stdout line to chat events + text/usage extractions.
 *
 * Layered on provider.parseStreamLine for the progress kinds
 * (thinking/tool/stage), with raw-line extraction for what the unified
 * parser can't carry: full reply text (stage summaries are capped at 200
 * characters) and cost.
 * Verified against the adapters: kind 'tokens' is the TERMINAL usage event
 * (claude `result`, codex `turn.completed`; 'final' is the reserved
 * equivalent) — usage, never reply text.
 */
export function mapChatLine(provider: Provider, line: string): MappedLine {
  const out: MappedLine = { events: [], text: null, resultText: null, usage: null };
  if (!line.trim()) return out;

  if (provider.id === 'claude') {
    try {
      const obj = JSON.parse(line);
      if (obj?.type === 'assistant' && Array.isArray(obj.message?.content)) {
        const parts = (obj.message.content as Array<{ type?: string; text?: unknown }>)
          .filter(p => p?.type === 'text' && typeof p.text === 'string')
          .map(p => p.text as string);
        if (parts.length > 0) out.text = parts.join('');
      }
      if (obj?.type === 'result') {
        if (typeof obj.result === 'string') out.resultText = obj.result;
        const u = obj.usage ?? {};
        out.usage = {
          costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : null,
          inputTokens: Number.isFinite(u.input_tokens) ? Number(u.input_tokens) : null,
          outputTokens: Number.isFinite(u.output_tokens) ? Number(u.output_tokens) : null,
          model: typeof obj.model === 'string' ? obj.model : null,
        };
      }
    } catch {
      // Non-JSON line — fall through to the unified mapping.
    }
  } else if (provider.id === 'codex') {
    try {
      const obj = JSON.parse(line);
      // Reply text is an `agent_message` item's `text` field (codex 0.142) —
      // NOT `message`/`content`, which never existed on this stream and left
      // codex replies blank in the transcript.
      if (
        obj?.type === 'item.completed' &&
        obj.item?.type === 'agent_message' &&
        typeof obj.item.text === 'string'
      ) {
        out.text = obj.item.text;
      }
    } catch {
      // Non-JSON line — fall through.
    }
  } else {
    // opencode: `run --format json` emits reply text as `text` parts.
    try {
      const obj = JSON.parse(line);
      if (obj?.type === 'text' && typeof obj.part?.text === 'string') {
        out.text = obj.part.text;
      }
    } catch {
      // Non-JSON (log line, etc.) — ignore.
    }
  }

  const ev = provider.parseStreamLine(line);
  if (ev) {
    if (ev.kind === 'thinking') {
      out.events.push({ type: 'thinking', text: ev.message });
    } else if (ev.kind === 'tool') {
      const sep = ev.message.indexOf(': ');
      const name = sep === -1 ? ev.message : ev.message.slice(0, sep);
      const detail = sep === -1 ? null : ev.message.slice(sep + 2);
      // toolStatus/toolId let a close event (tool_result / item.completed /
      // a completed tool part) resolve the running chip; absent status →
      // 'start' (back-compat). Emit `id` whenever the provider carried one so
      // foldEvents can pair open↔close by id even when the close has no name.
      out.events.push({
        type: 'tool',
        name,
        status: ev.toolStatus ?? 'start',
        ...(detail ? { detail } : {}),
        ...(ev.toolId ? { id: ev.toolId } : {}),
      });
    } else if (ev.kind === 'stage' && out.text === null) {
      // 'stage' duplicates the reply text on claude/opencode (assistant text
      // maps to 'stage' in the adapters) — only surface stages when the line
      // carried no reply text.
      out.events.push({ type: 'stage', label: ev.message });
    } else if ((ev.kind === 'tokens' || ev.kind === 'final') && ev.tokens && out.usage === null) {
      out.usage = {
        costUsd: null, // raw-line extraction above fills cost when the provider reports it
        inputTokens: ev.tokens.in,
        outputTokens: ev.tokens.out,
        model: ev.tokens.model,
      };
    }
  }
  if (out.text !== null) out.events.push({ type: 'text-delta', text: out.text });
  return out;
}

async function trackChatUsage(
  root: string,
  provider: ProviderId,
  model: string,
  usage: NonNullable<MappedLine['usage']>,
): Promise<void> {
  try {
    // Same dynamic-import pattern as jobs/runner.ts's close handler; mode
    // 'chat' attributes the spend on the analytics page (spec §3.6).
    const { trackProvider } = await import('../../../../cli/usage-tracker.mjs');
    trackProvider(provider, usage.inputTokens ?? 0, usage.outputTokens ?? 0, {
      cost_usd: usage.costUsd ?? undefined,
      model: usage.model || model,
      mode: 'chat',
      rootPath: root,
      estimated: false,
    });
  } catch (err) {
    // Never fail a turn over telemetry.
    console.warn('[chat] failed to track usage:', (err as Error).message);
  }
}

type AttemptCtx = {
  root: string;
  turn: TurnRecord;
  opts: {
    conversationId: string;
    userMessage?: string;
    pageContext?: string;
    attachments?: ChatAttachment[];
    referencedOffers?: number[];
    selections?: string[];
  };
  runtime: ModeRuntime;
  provider: Provider;
  caps: { resume: boolean };
  history: ChatMessage[];
  handle: AgentSessionHandle | null;
  isResuming: boolean;
  isReseed: boolean;
  /** The message this turn answers — opts.userMessage on a normal turn, the
   * re-run last user message on a regenerate. */
  userMessage: string;
  /** Files/mentions belonging to that message — opts.* on a normal turn, the
   * original user message's PERSISTED metadata on a regenerate (the route
   * forbids fresh ones there; rebuilding the prompt without the originals
   * would hand the model "what's in this file?" with no file to read). */
  attachments: ChatAttachment[] | undefined;
  referencedOffers: number[] | undefined;
  /** Version group the reply lands in (regenerate only). */
  versionGroup: string | null;
  /** Computed from the FULL pre-turn history (never the regenerate-sliced
   * prompt history) — a regenerate must never look like a first turn, or the
   * titler would re-exec on every regenerate of a one-exchange thread. */
  isFirstTurn: boolean;
};

export async function startTurn(
  root: string,
  opts: {
    conversationId: string;
    /** Required for a normal turn; derived (last user message) on regenerate. */
    userMessage?: string;
    /** Re-run the last user message; the new reply version-groups with the old. */
    regenerate?: boolean;
    /** Files uploaded with this turn's user message (Task 9). */
    attachments?: ChatAttachment[];
    /** Offer nums @-mentioned in this turn's user message (Task 10). */
    referencedOffers?: number[];
    provider?: string;
    model?: string;
    pageContext?: string;
    /** On-screen text selections staged as chips (Part 2) — ephemeral turn
     * context, rendered into the prompt but never persisted on the message. */
    selections?: string[];
  },
): Promise<{ turnId: string; userMessageId: string | null }> {
  // Synchronous check-and-add, BEFORE any await: two near-simultaneous
  // startTurn() calls for the same conversationId can't interleave here —
  // there's no yield point between the .has() check and the .add() below,
  // so the second call always observes the first call's claim. The lock is
  // released exactly once the turn truly finishes (see finishError and the
  // success branch below); everything from here to the `runAttempt` call is
  // "synchronous setup" whose failures must also release the lock, which the
  // surrounding try/catch guarantees.
  if (inFlightConversations.has(opts.conversationId)) {
    throw new Error('A turn is already running for this conversation.');
  }
  inFlightConversations.add(opts.conversationId);
  try {
    pruneTerminalTurns();
    const conversation = getConversation(root, opts.conversationId);
    if (!conversation) throw new Error(`conversation not found: ${opts.conversationId}`);

    // FR-4: resolve AND validate the provider/model BEFORE persisting the
    // user message. ProviderId.parse / resolveModeRuntime / getProvider can
    // all throw synchronously on a bad pinned provider/model — if that
    // happened after appendMessage (as it used to), the user message row
    // was already committed with no assistant reply: an orphan bubble that
    // also pollutes the next reseed transcript, and a retry would
    // double-append. Doing this first means a resolution throw leaves
    // message history untouched. This is a pure reorder, not a concurrency
    // change — the whole block below is synchronous (no await before
    // probeCapsSafe), so the lock acquired at the very top of startTurn is
    // still held before any of it runs either way.
    const override: RunOverride | undefined =
      opts.provider && opts.model
        ? { platform: ProviderId.parse(opts.provider), model: opts.model }
        : undefined;
    // 'chat' has no content/modes/chat.md and needs none: the waterfall in
    // registry.ts handles unknown mode ids — level 2 reads providers.modes.chat
    // when the user pins one in config.yml, level 3 the global default, and
    // level 5 falls back to claude + claude-sonnet-4-6. Level 4 (mode
    // front-matter) simply misses, and pickExec defaults to 'interactive'
    // (unused here). Verified against registry.ts — no registration needed.
    const runtime = resolveModeRuntime(root, 'chat', override);
    const provider = getProvider(runtime.provider);

    // History BEFORE this turn's user message: both the reseed transcript and
    // the resume-guard cursor refer to the pre-turn state.
    const history = listMessages(root, opts.conversationId);
    const lastAssistantMessageId =
      [...history].reverse().find(m => m.role === 'assistant')?.id ?? null;

    // Titler trigger, computed from the FULL history BEFORE the regenerate
    // slice below — the sliced prompt history of a one-exchange regenerate is
    // empty and would masquerade as a first turn.
    const isFirstTurn = !history.some(m => m.role === 'assistant');

    let userMessage: string;
    let promptHistory = history;
    let versionGroup: string | null = null;
    let attachments = opts.attachments;
    let referencedOffers = opts.referencedOffers;
    let userMessageId: string | null = null;
    if (opts.regenerate) {
      const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
      const lastUser = [...history].reverse().find(m => m.role === 'user');
      if (!lastAssistant || !lastUser) throw new Error('Nothing to regenerate yet.');
      userMessage = lastUser.content;
      // Re-run with the ORIGINAL message's attachments and offer mentions —
      // they are re-verified in buildTurnPrompt like any other turn's.
      attachments = lastUser.attachments ?? undefined;
      referencedOffers = lastUser.referencedOffers ?? undefined;
      // The old reply (and its priors) join one group; the new reply appends
      // into it. No user row is re-appended — same message, new spend.
      versionGroup = lastAssistant.versionGroup ?? randomUUID();
      if (!lastAssistant.versionGroup) {
        setMessageVersionGroup(root, lastAssistant.id, versionGroup);
      }
      // Prompt context: everything BEFORE the re-run user message (that
      // message is passed as userMessage; the discarded replies drop out).
      promptHistory = history.slice(
        0,
        history.findIndex(m => m.id === lastUser.id),
      );
      // A native resume would still contain the discarded reply in provider-
      // side context — force the next attempt to reseed from the filtered
      // transcript instead.
      clearAgentSession(root, opts.conversationId, runtime.provider);
    } else {
      if (!opts.userMessage?.trim() && !opts.attachments?.length) {
        throw new Error('message required');
      }
      userMessage = opts.userMessage ?? '';
      userMessageId = appendMessage(root, {
        conversationId: opts.conversationId,
        role: 'user',
        content: userMessage,
        attachments: opts.attachments,
        referencedOffers: opts.referencedOffers,
      }).id;
      // First message ever in this conversation → immediate fallback title so
      // the sessions list never shows a lingering 'New chat'.
      if (history.length === 0) applyFallbackTitle(root, opts.conversationId, userMessage);
    }

    // Controller-added hardening: a throwing probe (real or injected by a
    // test) must never break a turn — degrade to the resend path instead.
    const caps = await probeCapsSafe(provider);

    const handle = caps.resume
      ? getAgentSession(root, opts.conversationId, runtime.provider)
      : null;
    const verdict = validateResume(handle, {
      provider: runtime.provider,
      model: runtime.model,
      cwd: root,
      lastAssistantMessageId,
    });
    const isResuming = caps.resume && verdict.ok;

    const turnId = randomUUID();
    const turn: TurnRecord = {
      turnId,
      conversationId: opts.conversationId,
      events: [],
      seq: 0,
      status: 'running',
      startedAt: Date.now(),
      child: null,
      subscribers: new Set(),
    };
    turns.set(turnId, turn);

    // From here on, the lock is owned by the turn's own lifecycle
    // (finishError / the success branch of runAttempt's close handler /
    // cancelTurn) — including across a reseed, which is the same logical
    // turn and must NOT release between the first attempt and its reseed.
    runAttempt({
      root,
      turn,
      opts,
      runtime,
      provider,
      caps,
      history: promptHistory,
      handle,
      isResuming,
      isReseed: false,
      userMessage,
      attachments,
      referencedOffers,
      versionGroup,
      isFirstTurn,
    });
    return { turnId, userMessageId };
  } catch (err) {
    inFlightConversations.delete(opts.conversationId);
    throw err;
  }
}

function runAttempt(ctx: AttemptCtx): void {
  const {
    root,
    turn,
    opts,
    runtime,
    provider,
    caps,
    history,
    handle,
    isResuming,
    isReseed,
    userMessage,
    attachments,
    referencedOffers,
    versionGroup,
    isFirstTurn,
  } = ctx;

  // The ENTIRE synchronous prologue — prompt build, tmp-file write, arg build
  // — is one try/catch funneling through finishError. This matters for the
  // reseed call: it's invoked from inside the child 'close' handler with no
  // surrounding try/catch of its own (unlike the initial call, which sits
  // inside startTurn's try/catch), so an uncaught throw here would otherwise
  // escape the close handler entirely — finishError never runs, the
  // conversation's in-flight lock never releases, and the turn is wedged
  // until server restart. Widening the catch (rather than only wrapping
  // buildChatArgs) hardens both call sites symmetrically since runAttempt is
  // shared between them.
  // promptFile stays `| undefined` (rather than definite-assignment `!`)
  // because buildTurnPrompt can throw BEFORE the join()/writeFileSync below
  // ever runs — the catch below needs to tell finishError whether a file
  // actually landed on disk (FR-9).
  let promptFile: string | undefined;
  let mcpConfigPath: string | undefined;
  let freshSessionId: string | undefined;
  let built: SpawnArgs;
  try {
    const prompt = buildTurnPrompt({
      root,
      conversationId: opts.conversationId,
      messages: history,
      userMessage,
      isResuming,
      pageContext: opts.pageContext,
      attachments,
      referencedOffers,
      // Selections are ephemeral (not persisted on the message), so they ride
      // opts directly — a regenerate carries none, same as pageContext.
      selections: opts.selections,
    });
    promptFile = join(tmpdir(), `sur9e-chat-${turn.turnId}${isReseed ? '-reseed' : ''}.md`);
    writeFileSync(promptFile, prompt, 'utf-8');

    // Per-turn MCP config wiring the sur9e-app server (cli/mcp-app-server.mjs)
    // into this turn's spawned CLI. Same turn.turnId across a reseed's second
    // attempt → writeMcpConfigForTurn resolves to the same path both times,
    // so the reseed's rewrite simply refreshes the file the first attempt's
    // close handler is about to (or just did) unlink — see the close/error
    // handlers below.
    mcpConfigPath = writeMcpConfigForTurn(root, { turnId: turn.turnId, appUrl: detectAppUrl() });

    freshSessionId = isResuming ? undefined : randomUUID();
    // mcpConfigPath is passed to every provider uniformly (BuildChatArgsOpts
    // declares it, so this is type-safe for all three adapters) and all three
    // now CONSUME it to pin THIS turn's id onto the sur9e-app server. That turn
    // id is what makes the action routes emit a confirm card (x-sur9e-turn
    // header → confirms.ts) instead of falling back to model-adjudicated
    // `terminalApproved` with no card:
    //   claude.ts   — --mcp-config --strict-mcp-config (turn-scoped server file)
    //   codex.ts    — both generated servers re-expressed as turn-scoped -c
    //                 overrides, including the sur9e-app turn environment
    //   opencode.ts — both servers registered in the per-turn read-only config
    // codex/opencode chat is still flagged experimental for OTHER reasons, but
    // the confirm-card gating itself is now wired for all three — not claude-only.
    built = provider.buildChatArgs({
      promptFile,
      model: runtime.model,
      resumeSessionId: isResuming && handle ? handle.providerSessionId : undefined,
      sessionId: freshSessionId,
      mcpConfigPath,
    });
  } catch (err) {
    // FR-9: buildChatArgs (or anything else in this prologue) can throw
    // AFTER writeFileSync/writeMcpConfigForTurn already wrote their files but
    // BEFORE spawnImpl ever ran — no close/error handler will ever fire to
    // unlink them, so finishError needs the paths to best-effort clean up
    // itself. Humanize the throw (never surface the raw Node error) — the
    // failure text only feeds classification, the shown message is a template.
    const { message, category } = humanizeProviderError(provider.id, {
      stderr: (err as Error).message,
    });
    finishError(turn, message, { promptFile, mcpConfigPath, category });
    return;
  }
  // Reaching here means the try block ran to completion, so promptFile and
  // mcpConfigPath were necessarily assigned — narrow them to definite
  // strings once so the close/error handlers below (which TS can't otherwise
  // prove ran only after a successful assignment) don't need `| undefined`
  // handling.
  const spawnedPromptFile = promptFile as string;
  const spawnedMcpConfigPath = mcpConfigPath as string;

  const child = spawnImpl(built.cmd, built.args, {
    cwd: root,
    env: { ...process.env, ...built.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  turn.child = child;

  let stdoutAll = '';
  let stderrAll = '';
  let lineBuffer = '';
  let assistantText = '';
  let resultText: string | null = null;
  let usage: MappedLine['usage'] = null;
  let capturedSessionId: string | null = null;
  let settled = false;
  let timedOut = false;

  const handleLine = (line: string): void => {
    if (capturedSessionId === null) {
      const sid = provider.extractSessionId(line);
      if (sid) capturedSessionId = sid;
    }
    const mapped = mapChatLine(provider, line);
    if (mapped.text !== null) assistantText += mapped.text;
    if (mapped.resultText !== null) resultText = mapped.resultText;
    if (mapped.usage !== null) usage = mapped.usage;
    for (const payload of mapped.events) emitTurnEvent(turn.turnId, payload);
  };

  child.stdout?.on('data', (d: Buffer) => {
    const text = d.toString();
    stdoutAll += text;
    lineBuffer += text;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  });
  child.stderr?.on('data', (d: Buffer) => {
    stderrAll += d.toString();
  });

  const killTimer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }, TURN_TIMEOUT_MS);

  const persistPartial = (): void => {
    const partial = resultText ?? assistantText;
    if (partial.trim()) {
      appendMessage(root, {
        conversationId: opts.conversationId,
        role: 'assistant',
        content: partial,
        events: turn.events,
        versionGroup,
      });
    }
  };

  child.on('close', (code: number | null) => {
    clearTimeout(killTimer);
    if (settled) return;
    settled = true;
    try {
      unlinkSync(spawnedPromptFile);
    } catch {
      // best-effort tmp cleanup
    }
    try {
      unlinkSync(spawnedMcpConfigPath);
    } catch {
      // best-effort tmp cleanup
    }
    if (turn.status !== 'running') {
      // cancelTurn already settled the turn (emitted the terminal 'cancelled'
      // error) but deliberately deferred the in-flight lock release until
      // the child actually died (FR-5) — that moment is now, so release it
      // here rather than when SIGTERM was merely requested.
      inFlightConversations.delete(turn.conversationId);
      return;
    }
    if (lineBuffer.trim()) handleLine(lineBuffer);

    // A resume the provider rejected (session evicted, cache wiped): clear
    // the stale handle and reseed ONCE with the full transcript. isReseed
    // guards the recursion — a second failure lands in the error branch
    // below, never a loop. Invisible to the user (spec §3.1).
    if (isResuming && !isReseed && provider.detectResumeFailure(stdoutAll, stderrAll)) {
      clearAgentSession(root, opts.conversationId, runtime.provider);
      runAttempt({ ...ctx, handle: null, isResuming: false, isReseed: true });
      return;
    }

    if (timedOut) {
      persistPartial();
      finishError(turn, 'turn timed out after 10 minutes');
      return;
    }
    if (code !== 0) {
      persistPartial();
      // Never surface the raw stderr tail — humanize the failure into a clean,
      // actionable sentence (+ a category the UI can branch on).
      const { message: humanMessage, category } = humanizeProviderError(provider.id, {
        stdout: stdoutAll,
        stderr: stderrAll,
        code,
      });
      finishError(turn, humanMessage, { category });
      return;
    }

    const finalText = resultText ?? assistantText;
    // Exit 0 but no reply text at all — the old path appended an empty message
    // and emitted 'done', leaving an empty bubble. Treat it as an error.
    if (!finalText.trim()) {
      finishError(turn, 'The assistant returned an empty reply — try again.');
      return;
    }
    const message = appendMessage(root, {
      conversationId: opts.conversationId,
      role: 'assistant',
      content: finalText,
      events: turn.events,
      versionGroup,
    });
    // claude --resume forks the conversation under a NEW session id, so the
    // id to store is always the one captured from this run's init event —
    // falling back to the requested id only when none was captured.
    const sessionId =
      capturedSessionId ??
      (isResuming && handle ? handle.providerSessionId : freshSessionId) ??
      null;
    if (caps.resume && sessionId) {
      saveAgentSession(root, {
        conversationId: opts.conversationId,
        provider: runtime.provider,
        providerSessionId: sessionId,
        model: runtime.model,
        cwd: root,
        lastMessageId: message.id,
      });
    }
    if (usage) {
      emitTurnEvent(turn.turnId, { type: 'usage', ...usage });
      void trackChatUsage(root, runtime.provider, runtime.model, usage);
    }
    turn.status = 'done';
    emitTurnEvent(turn.turnId, { type: 'done', messageId: message.id });
    // Mirrors finishError's release: the turn (including any reseed) is now
    // truly finished, so a new startTurn for this conversation may proceed.
    inFlightConversations.delete(turn.conversationId);
    // First COMPLETED turn → fire-and-forget the AI titler (cheap model).
    // generateConversationTitle never throws; a failure keeps the fallback.
    // Gate on isFirstTurn (full pre-turn history), NOT ctx.history — on a
    // regenerate that's the sliced prompt history, which is empty for a
    // one-exchange thread and would wrongly re-fire the titler.
    if (isFirstTurn) {
      void generateConversationTitle({
        root,
        conversationId: opts.conversationId,
        provider,
        model: runtime.model,
        userMessage,
        assistantReply: finalText,
      });
    }
  });

  child.on('error', (err: Error) => {
    clearTimeout(killTimer);
    if (settled) return;
    settled = true;
    try {
      unlinkSync(spawnedPromptFile);
    } catch {
      // best-effort tmp cleanup
    }
    try {
      unlinkSync(spawnedMcpConfigPath);
    } catch {
      // best-effort tmp cleanup
    }
    if (turn.status !== 'running') {
      // Symmetric with the close handler above: a cancelled turn whose
      // child errors out (instead of closing normally) still needs the
      // lock released now that it's truly gone (FR-5).
      inFlightConversations.delete(turn.conversationId);
      return;
    }
    // A spawn failure (e.g. `spawn claude ENOENT`) — humanize rather than
    // showing the bare Node error string.
    const { message, category } = humanizeProviderError(provider.id, { stderr: err.message });
    finishError(turn, message, { category });
  });
}

/**
 * Explicit stop (tier 2 of the two-tier cancellation — tier 1, closing the
 * SSE stream, only detaches). Emits a terminal error event immediately,
 * then SIGTERM → SIGKILL after 5s. Returns false when the turn is unknown
 * or already settled.
 *
 * FR-5: the terminal 'cancelled' error is emitted synchronously below (the
 * user sees the cancel immediately), but the in-flight conversation lock is
 * NOT released here — the child is typically still alive at this point
 * (SIGTERM was just requested, not yet honored). Releasing the lock now
 * would let a new startTurn spawn a second child for the same conversation
 * while the cancelled one is still running, briefly violating the
 * one-process-per-conversation invariant and risking double work. Instead
 * runAttempt's own close/error handler for THIS child releases the lock
 * once the child has truly exited (matched on turn.status !== 'running',
 * which finishError set below) — see the two spots there tagged FR-5. If
 * there's somehow no child yet (shouldn't happen: runAttempt sets turn.child
 * synchronously before startTurn's promise resolves), release immediately
 * rather than wedge the lock forever.
 */
export function cancelTurn(turnId: string): boolean {
  const turn = turns.get(turnId);
  if (!turn || turn.status !== 'running') return false;
  const child = turn.child;
  finishError(turn, 'cancelled', { releaseLock: !child });
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
    const hardKill = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, CANCEL_GRACE_MS);
    child.once('close', () => clearTimeout(hardKill));
  }
  return true;
}
