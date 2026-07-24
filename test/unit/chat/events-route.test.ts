// test/unit/chat/events-route.test.ts
//
// Regression test for the heartbeat-interval leak fixed in the events SSE
// route (task 10 fix report): the ReadableStream's start() used to arm its
// `setInterval(...)` heartbeat unconditionally, even when the stream had
// already closed earlier in the same start() call (replay hitting a
// terminal event, or the turn already being terminal on connect). That left
// a live interval + a phantom `turn.subscribers` entry around for up to
// HEARTBEAT_MS on every reconnect to an already-finished turn.
//
// This drives a REAL turn to 'done' via turn-runner's injection hooks
// (_setSpawnImpl / _setProbeImpl, same pattern as turn-runner.test.ts)
// against a throwaway mkdtempSync root — never the user's real ROOT, so this
// does not run afoul of the "no route tests against real ROOT" guidance in
// the task-10 brief (that guidance is about routes that read/write user data
// through `@/lib/root`'s ROOT; the events route touches none of that — it
// only reads the in-memory turn registry via getTurn/subscribeTurn). It then
// calls the route's exported GET directly and proves no heartbeat interval
// is ever armed once the stream has closed, by spying on global setInterval.

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as postTurn } from '@/app/api/chat/sessions/[id]/turns/route';
import { GET } from '@/app/api/chat/turns/[id]/events/route';
import { closeChatDb } from '@/lib/server/chat/db';
import { createConversation } from '@/lib/server/chat/store';
import { _setTitleExecImpl } from '@/lib/server/chat/titler';
import {
  _setProbeImpl,
  _setSpawnImpl,
  getTurn,
  startTurn,
  subscribeTurn,
} from '@/lib/server/chat/turn-runner';

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
    // `unsub` must be `let` + assigned before the callback can reference it:
    // subscribeTurn replays buffered events SYNCHRONOUSLY before returning,
    // so when the turn is already terminal (unlike turn-runner.test.ts's
    // usage, always subscribed pre-terminal), the callback fires DURING the
    // subscribeTurn(...) call itself — a `const unsub = subscribeTurn(...)`
    // would hit the TDZ referencing `unsub` inside that same-tick callback.
    let unsub: (() => void) | null = null;
    unsub = subscribeTurn(
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

/** Drain a Response's ReadableStream body to completion (never hangs). */
async function drain(res: Response): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

/** Drain a Response's SSE body and parse out every `data:` frame's seq. */
async function collectSeqs(res: Response): Promise<number[]> {
  const reader = res.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    if (done) break;
  }
  return buf
    .split('\n\n')
    .map(block => block.split('\n').find(line => line.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map(line => (JSON.parse(line.slice('data: '.length)) as { seq: number }).seq);
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-events-route-'));
  _setProbeImpl(async () => ({ resume: true }));
  // Completed first turns fire-and-forget the AI titler — neutralize its
  // exec so no real provider CLI is ever spawned from a unit test.
  _setTitleExecImpl(async () => ({ stdout: '' }));
});

afterEach(() => {
  _setSpawnImpl(null);
  _setProbeImpl(null);
  _setTitleExecImpl(null);
  closeChatDb(root);
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/chat/turns/:id/events — heartbeat leak on an already-terminal turn', () => {
  it('does not arm a heartbeat interval when ?after already covers the terminal event', async () => {
    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-1', 'hi')) as never);
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(turnId);
    const finalSeq = getTurn(turnId)?.seq ?? 0;
    expect(finalSeq).toBeGreaterThan(0);

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const request = new Request(
      `http://localhost/api/chat/turns/${turnId}/events?after=${finalSeq}`,
    );
    const res = await GET(request, { params: Promise.resolve({ id: turnId }) });
    expect(res.status).toBe(200);
    await drain(res);

    // Proves the leak is gone: the buggy code armed setInterval unconditionally
    // at the end of start(), even though the short-circuit above had already
    // closed the stream (afterSeq >= current.seq, turn not running).
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('does not arm a heartbeat interval when the replay itself delivers the terminal event', async () => {
    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-2', 'hey')) as never);
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(turnId);

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    // No ?after — replay delivers every buffered event, including the
    // terminal 'done', which closes the stream mid-replay (path (a) in the
    // bug report) before start() reaches the setInterval line.
    const request = new Request(`http://localhost/api/chat/turns/${turnId}/events`);
    const res = await GET(request, { params: Promise.resolve({ id: turnId }) });
    expect(res.status).toBe(200);
    await drain(res);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('still arms the heartbeat for a genuinely running turn (control case)', async () => {
    let child: FakeChild | null = null;
    _setSpawnImpl(() => {
      child = fakeChild(); // hangs — turn stays 'running'
      return child as never;
    });
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    expect(getTurn(turnId)?.status).toBe('running');

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const request = new Request(`http://localhost/api/chat/turns/${turnId}/events`);
    const res = await GET(request, { params: Promise.resolve({ id: turnId }) });
    expect(res.status).toBe(200);

    // A live turn legitimately needs the heartbeat armed — this is the case
    // the `if (!closed)` guard must NOT suppress.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const armedInterval = setIntervalSpy.mock.results[0]?.value;
    setIntervalSpy.mockRestore();

    // Tear down without waiting on stream plumbing (the test only needs to
    // prove the interval was armed, not exercise full teardown): clear the
    // interval directly, finish the child, and let the turn settle.
    if (armedInterval) clearInterval(armedInterval);
    child!.stdout.emit(
      'data',
      Buffer.from(`${initLine('sess-3')}\n${textLine('ok')}\n${resultLine('ok')}\n`),
    );
    child!.emit('close', 0);
    await waitForTerminal(turnId);
  });

  it('does not leave a phantom subscriber when the replay itself hits the terminal event', async () => {
    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-4', 'yo')) as never);
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(turnId);

    // afterSeq=0 replays every buffered event, including the terminal 'done'
    // — the exact path where subscribeTurn's synchronous replay invokes
    // send() -> closeStream() before the `unsubscribe` const has been
    // assigned, so closeStream's `unsubscribe?.()` is a no-op and
    // subscribeTurn's own `turn.subscribers.add(fn)` (which runs after the
    // replay loop, unconditionally) leaves a phantom entry behind.
    const request = new Request(`http://localhost/api/chat/turns/${turnId}/events?after=0`);
    const res = await GET(request, { params: Promise.resolve({ id: turnId }) });
    expect(res.status).toBe(200);
    await drain(res);

    // The phantom subscriber must be swept deterministically once closeStream
    // has latched during the synchronous replay — otherwise it stays pinned
    // in turn.subscribers until the opportunistic ~1h GC.
    expect(getTurn(turnId)?.subscribers.size).toBe(0);
  });
});

describe('GET /api/chat/turns/:id/events — Last-Event-ID resume (FR-2)', () => {
  it('replays only events with seq > the Last-Event-ID header when ?after is absent', async () => {
    // Native browser EventSource cannot set a query param on its automatic
    // reconnect — it sends the last `id:` it saw back as the Last-Event-ID
    // HTTP header instead. Without reading that header, every transient
    // drop reconnects with afterSeq=0 and re-replays the whole turn.
    _setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-5', 'hi there')) as never);
    const conv = createConversation(root);
    const { turnId } = await startTurn(root, { conversationId: conv.id, userMessage: 'hello' });
    await waitForTerminal(turnId);

    const allEvents = getTurn(turnId)?.events ?? [];
    // Need at least two events so a mid-stream cursor actually excludes one.
    expect(allEvents.length).toBeGreaterThan(1);
    const cursor = allEvents[0].seq;

    const request = new Request(`http://localhost/api/chat/turns/${turnId}/events`, {
      headers: { 'Last-Event-ID': String(cursor) },
    });
    const res = await GET(request, { params: Promise.resolve({ id: turnId }) });
    expect(res.status).toBe(200);

    const seqs = await collectSeqs(res);
    expect(seqs.length).toBeGreaterThan(0);
    expect(seqs.every(seq => seq > cursor)).toBe(true);
  });
});
