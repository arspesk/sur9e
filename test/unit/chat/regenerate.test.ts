import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeChatDb } from '@/lib/server/chat/db';
import { createConversation, listMessages } from '@/lib/server/chat/store';
import { _setTitleExecImpl } from '@/lib/server/chat/titler';
import { _setProbeImpl, _setSpawnImpl, startTurn } from '@/lib/server/chat/turn-runner';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill(): boolean {
    return true;
  }
}

let root: string;
let child: FakeChild;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-regen-'));
  _setProbeImpl(async () => ({ resume: false }));
  _setTitleExecImpl(async () => ({ stdout: '' }));
  _setSpawnImpl(() => {
    child = new FakeChild();
    return child as never;
  });
});

afterEach(() => {
  _setSpawnImpl(null);
  _setProbeImpl(null);
  _setTitleExecImpl(null);
  closeChatDb(root);
  rmSync(root, { recursive: true, force: true });
});

function finishTurn(text: string): void {
  child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'result', result: text })}\n`));
  child.emit('close', 0);
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('condition never became true');
}

describe('regenerate', () => {
  it('re-runs the last user message without duplicating it and version-groups the replies', async () => {
    const c = createConversation(root);
    await startTurn(root, { conversationId: c.id, userMessage: 'compare my offers' });
    finishTurn('reply v1');
    await until(() => listMessages(root, c.id).length === 2);

    await startTurn(root, { conversationId: c.id, regenerate: true });
    finishTurn('reply v2');
    await until(() => listMessages(root, c.id).length === 3);

    const msgs = listMessages(root, c.id);
    expect(msgs.filter(m => m.role === 'user')).toHaveLength(1);
    const [v1, v2] = msgs.filter(m => m.role === 'assistant');
    expect(v1.versionGroup).not.toBeNull();
    expect(v1.versionGroup).toBe(v2.versionGroup);
    expect(v2.content).toBe('reply v2');
    expect(v2.position).toBeGreaterThan(v1.position);
  });

  it('regenerate with no prior assistant reply rejects', async () => {
    const c = createConversation(root);
    await expect(startTurn(root, { conversationId: c.id, regenerate: true })).rejects.toThrow(
      /nothing to regenerate/i,
    );
  });

  it('regenerate carries the original message attachments and mentions into the prompt', async () => {
    const prompts: string[] = [];
    _setSpawnImpl((_cmd, args) => {
      // Same prompt-capture pattern as turn-runner.test.ts: claude's chat args
      // feed the prompt file via stdin redirection (< '<file>').
      const m = args.join(' ').match(/< '([^']+)'/);
      if (m) prompts.push(readFileSync(m[1], 'utf-8'));
      child = new FakeChild();
      return child as never;
    });
    const c = createConversation(root);
    const fileId = randomUUID();
    const dir = join(root, 'data', 'chat', 'uploads', c.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${fileId}.txt`), 'attached notes', 'utf-8');
    const attachment = {
      path: `${c.id}/${fileId}.txt`,
      name: 'notes.txt',
      mime: 'text/plain',
      size: 14,
    };
    await startTurn(root, {
      conversationId: c.id,
      userMessage: 'what is in this file?',
      attachments: [attachment],
      referencedOffers: [3],
    });
    finishTurn('reply v1');
    await until(() => listMessages(root, c.id).length === 2);

    await startTurn(root, { conversationId: c.id, regenerate: true });
    finishTurn('reply v2');
    await until(() => listMessages(root, c.id).length === 3);

    expect(prompts).toHaveLength(2);
    // Sanity: the original turn's prompt carried the metadata.
    expect(prompts[0]).toContain(`${fileId}.txt`);
    expect(prompts[0]).toContain('#3');
    // The regenerate rebuild must re-read the ORIGINAL user message's
    // persisted attachments/mentions — without them the model is handed
    // "what is in this file?" with no file path to read.
    expect(prompts[1]).toContain('what is in this file?');
    expect(prompts[1]).toContain(`${fileId}.txt`);
    expect(prompts[1]).toContain('#3');
  });

  it('regenerate on a one-exchange thread does NOT re-fire the AI titler', async () => {
    // The titler's first-turn check must look at the FULL history, not the
    // sliced regenerate prompt history — otherwise every regenerate of a
    // one-exchange thread looks like a first turn and re-execs the titler.
    let titlerCalls = 0;
    _setTitleExecImpl(async () => {
      titlerCalls += 1;
      return { stdout: '' };
    });

    const c = createConversation(root);
    await startTurn(root, { conversationId: c.id, userMessage: 'compare my offers' });
    finishTurn('reply v1');
    await until(() => listMessages(root, c.id).length === 2);
    await until(() => titlerCalls === 1); // first completed turn fires it once

    await startTurn(root, { conversationId: c.id, regenerate: true });
    finishTurn('reply v2');
    await until(() => listMessages(root, c.id).length === 3);
    // Give a fire-and-forget titler exec a beat to (wrongly) run.
    await new Promise(r => setTimeout(r, 50));
    expect(titlerCalls).toBe(1);
  });
});
