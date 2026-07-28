// test/unit/chat/turns-route.test.ts
//
// Onboarding preflight for POST /api/chat/sessions/[id]/turns (Plan 3 Task
// 0): a brand-new install with no inputs/personalization/cv.md or
// profile.yml must get `{ setupRequired: true }` back instead of a turn
// that's guaranteed to fail deep inside the spawned agent — the same
// predicate the jobs flow already gates on (getOnboardingStatus in
// src/lib/server/onboarding-status.ts, reused verbatim here, no new file).
//
// Pattern B (see chat-action-routes.test.ts): tmpdir + SUR9E_ROOT +
// vi.resetModules() + dynamic import, because the route's `ROOT` binding
// (src/lib/root.ts) is a module-level const read once at import time — a
// static top-of-file import would always resolve to process.cwd(), not this
// test's throwaway root. store/turn-runner are imported dynamically too so
// they share the same module instance the freshly-imported route uses
// (turn-runner keeps an in-memory `turns` map keyed per module instance).
//
// The "proceeds" case drives a real turn to 'done' via turn-runner's
// injection hooks (_setSpawnImpl / _setProbeImpl), same pattern as
// events-route.test.ts / turn-runner.test.ts.

import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function postTurn(id: string, message = 'hello'): Request {
  return new Request(`http://localhost/api/chat/sessions/${id}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

function seedRoot(opts: { withUserFiles: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'chat-turns-route-'));
  if (opts.withUserFiles) {
    mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
    writeFileSync(join(root, 'inputs/personalization/cv.md'), '# CV\n', 'utf-8');
    writeFileSync(join(root, 'inputs/personalization/profile.yml'), 'name: Test\n', 'utf-8');
  }
  return root;
}

type TurnsRoute = typeof import('@/app/api/chat/sessions/[id]/turns/route');
type ChatStore = typeof import('@/lib/server/chat/store');
type TurnRunner = typeof import('@/lib/server/chat/turn-runner');
type ChatDb = typeof import('@/lib/server/chat/db');
type Titler = typeof import('@/lib/server/chat/titler');

let root: string;
let turnsRoute: TurnsRoute;
let store: ChatStore;
let turnRunner: TurnRunner;
let db: ChatDb;
let titler: Titler;

async function loadRoot(opts: { withUserFiles: boolean }): Promise<void> {
  root = seedRoot(opts);
  process.env.SUR9E_ROOT = root;
  vi.resetModules();
  turnsRoute = await import('@/app/api/chat/sessions/[id]/turns/route');
  store = await import('@/lib/server/chat/store');
  turnRunner = await import('@/lib/server/chat/turn-runner');
  db = await import('@/lib/server/chat/db');
  titler = await import('@/lib/server/chat/titler');
  // Completed first turns fire-and-forget the AI titler — neutralize its
  // exec so no real provider CLI is ever spawned from a unit test.
  titler._setTitleExecImpl(async () => ({ stdout: '' }));
}

afterEach(() => {
  turnRunner._setSpawnImpl(null);
  turnRunner._setProbeImpl(null);
  titler._setTitleExecImpl(null);
  db.closeChatDb(root);
  rmSync(root, { recursive: true, force: true });
  delete process.env.SUR9E_ROOT;
  vi.clearAllMocks();
});

describe('POST /api/chat/sessions/[id]/turns — onboarding preflight', () => {
  it('returns setupRequired instead of starting a turn when cv.md/profile.yml are missing', async () => {
    await loadRoot({ withUserFiles: false });
    const conv = store.createConversation(root);

    const spawnSpy = vi.fn();
    turnRunner._setSpawnImpl(spawnSpy as never);

    const res = await turnsRoute.POST(postTurn(conv.id), {
      params: Promise.resolve({ id: conv.id }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ setupRequired: true });
    // No turn was ever started, so the CLI process was never spawned.
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('proceeds to start a turn when cv.md and profile.yml both exist', async () => {
    await loadRoot({ withUserFiles: true });
    const conv = store.createConversation(root);
    turnRunner._setProbeImpl(async () => ({ resume: true }));
    turnRunner._setSpawnImpl(() => fakeChild(c => happyStream(c, 'sess-1', 'hi')) as never);

    const res = await turnsRoute.POST(postTurn(conv.id), {
      params: Promise.resolve({ id: conv.id }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(typeof body.turnId).toBe('string');
    expect(typeof body.userMessageId).toBe('string');
    expect(body.setupRequired).toBeUndefined();

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('turn never settled')), 2000);
      let unsub: (() => void) | null = null;
      unsub = turnRunner.subscribeTurn(
        body.turnId,
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
    expect(turnRunner.getTurn(body.turnId)?.status).toBe('done');
  });
});
