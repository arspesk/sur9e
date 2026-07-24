import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeChatDb, openChatDb } from '@/lib/server/chat/db';
import {
  appendMessage,
  clearAgentSession,
  createConversation,
  deleteConversation,
  getAgentSession,
  getConversation,
  listConversations,
  listMessages,
  renameConversation,
  saveAgentSession,
  setAutoTitle,
  setConversationArchived,
  setMessageVersionGroup,
} from '@/lib/server/chat/store';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-store-'));
});

afterEach(() => {
  closeChatDb(root);
  rmSync(root, { recursive: true, force: true });
});

describe('conversations', () => {
  it('createConversation defaults title to "New chat" and mode to null', () => {
    const c = createConversation(root);
    expect(c.title).toBe('New chat');
    expect(c.mode).toBeNull();
    expect(c.archived).toBe(false);
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(getConversation(root, c.id)).toEqual(c);
  });

  it('createConversation honors title and mode opts', () => {
    const c = createConversation(root, { title: 'Offers talk', mode: 'offers' });
    expect(c.title).toBe('Offers talk');
    expect(c.mode).toBe('offers');
  });

  it('listConversations orders by updated_at DESC and includes archived', async () => {
    const a = createConversation(root, { title: 'a' });
    await new Promise(r => setTimeout(r, 5)); // distinct ISO timestamps
    const b = createConversation(root, { title: 'b' });
    expect(listConversations(root).map(c => c.id)).toEqual([b.id, a.id]);
    // Touching a's messages bumps updated_at → a moves to the front.
    await new Promise(r => setTimeout(r, 5));
    appendMessage(root, { conversationId: a.id, role: 'user', content: 'hi' });
    expect(listConversations(root).map(c => c.id)).toEqual([a.id, b.id]);
  });

  it('getConversation returns null for an unknown id', () => {
    expect(getConversation(root, 'nope')).toBeNull();
  });

  it('renameConversation updates the title', () => {
    const c = createConversation(root);
    renameConversation(root, c.id, 'Better name');
    expect(getConversation(root, c.id)?.title).toBe('Better name');
  });

  it('deleteConversation cascades messages and agent sessions', () => {
    const c = createConversation(root);
    appendMessage(root, { conversationId: c.id, role: 'user', content: 'hi' });
    saveAgentSession(root, {
      conversationId: c.id,
      provider: 'claude',
      providerSessionId: 's1',
      model: 'claude-sonnet-4-6',
      cwd: root,
      lastMessageId: null,
    });
    deleteConversation(root, c.id);
    expect(getConversation(root, c.id)).toBeNull();
    expect(listMessages(root, c.id)).toEqual([]);
    expect(getAgentSession(root, c.id, 'claude')).toBeNull();
  });
});

describe('title source', () => {
  it('setAutoTitle writes while source is auto/null, refuses after a manual rename', () => {
    const c = createConversation(root);
    expect(setAutoTitle(root, c.id, 'Auto one')).toBe(true);
    expect(getConversation(root, c.id)?.title).toBe('Auto one');
    renameConversation(root, c.id, 'Manual');
    expect(getConversation(root, c.id)?.titleSource).toBe('manual');
    expect(setAutoTitle(root, c.id, 'Auto two')).toBe(false);
    expect(getConversation(root, c.id)?.title).toBe('Manual');
  });
});

describe('messages', () => {
  it('appendMessage assigns positions 0,1,2… and bumps conversation updated_at', async () => {
    const c = createConversation(root);
    await new Promise(r => setTimeout(r, 5));
    const m0 = appendMessage(root, { conversationId: c.id, role: 'user', content: 'q' });
    const m1 = appendMessage(root, {
      conversationId: c.id,
      role: 'assistant',
      content: 'a',
      events: [{ seq: 1, type: 'stage', label: 'init' }],
    });
    expect(m0.position).toBe(0);
    expect(m1.position).toBe(1);
    expect(m1.events).toEqual([{ seq: 1, type: 'stage', label: 'init' }]);
    const after = getConversation(root, c.id);
    expect(after && after.updatedAt > c.updatedAt).toBe(true);
  });

  it('appendMessage throws for an unknown conversation', () => {
    expect(() =>
      appendMessage(root, { conversationId: 'nope', role: 'user', content: 'x' }),
    ).toThrow(/conversation not found/);
  });

  it('listMessages returns position order with parsed events', () => {
    const c = createConversation(root);
    appendMessage(root, { conversationId: c.id, role: 'user', content: 'one' });
    appendMessage(root, { conversationId: c.id, role: 'assistant', content: 'two' });
    const msgs = listMessages(root, c.id);
    expect(msgs.map(m => m.content)).toEqual(['one', 'two']);
    expect(msgs[0].events).toBeNull();
  });
});

describe('version groups', () => {
  it('appendMessage persists versionGroup; setMessageVersionGroup backfills', () => {
    const c = createConversation(root);
    const u = appendMessage(root, { conversationId: c.id, role: 'user', content: 'q' });
    const a1 = appendMessage(root, { conversationId: c.id, role: 'assistant', content: 'v1' });
    expect(a1.versionGroup).toBeNull();
    setMessageVersionGroup(root, a1.id, 'g1');
    const a2 = appendMessage(root, {
      conversationId: c.id,
      role: 'assistant',
      content: 'v2',
      versionGroup: 'g1',
    });
    const msgs = listMessages(root, c.id);
    expect(msgs.map(m => m.versionGroup)).toEqual([null, 'g1', 'g1']);
    expect(u.versionGroup).toBeNull();
    expect(a2.versionGroup).toBe('g1');
  });
});

describe('attachments', () => {
  it('appendMessage persists attachment metadata and round-trips through listMessages', () => {
    const c = createConversation(root);
    // path must satisfy the strict uuid/uuid.ext schema shape (see ChatAttachment)
    const att = [
      {
        path: `${c.id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`,
        name: 'shot.png',
        mime: 'image/png',
        size: 3,
      },
    ];
    const m = appendMessage(root, {
      conversationId: c.id,
      role: 'user',
      content: 'look at this',
      attachments: att,
    });
    expect(m.attachments).toEqual(att);
    expect(listMessages(root, c.id)[0].attachments).toEqual(att);
  });

  it('messages without attachments read back null', () => {
    const c = createConversation(root);
    appendMessage(root, { conversationId: c.id, role: 'user', content: 'plain' });
    expect(listMessages(root, c.id)[0].attachments).toBeNull();
  });
});

describe('referenced offers', () => {
  it('appendMessage persists referencedOffers round-trip', () => {
    const c = createConversation(root);
    const m = appendMessage(root, {
      conversationId: c.id,
      role: 'user',
      content: 'compare @Attio #3 and @Linear #48',
      referencedOffers: [3, 48],
    });
    expect(m.referencedOffers).toEqual([3, 48]);
    expect(listMessages(root, c.id)[0].referencedOffers).toEqual([3, 48]);
  });
});

describe('agent sessions', () => {
  const handle = (conversationId: string) => ({
    conversationId,
    provider: 'claude',
    providerSessionId: 'sess-1',
    model: 'claude-sonnet-4-6',
    cwd: '/tmp/x',
    lastMessageId: null as string | null,
  });

  it('save + get round-trips, upsert overwrites on the (conversation, provider) key', () => {
    const c = createConversation(root);
    saveAgentSession(root, handle(c.id));
    expect(getAgentSession(root, c.id, 'claude')?.providerSessionId).toBe('sess-1');
    saveAgentSession(root, { ...handle(c.id), providerSessionId: 'sess-2', lastMessageId: 'm9' });
    const got = getAgentSession(root, c.id, 'claude');
    expect(got?.providerSessionId).toBe('sess-2');
    expect(got?.lastMessageId).toBe('m9');
  });

  it('get returns null for unknown pair; clear removes the row', () => {
    const c = createConversation(root);
    expect(getAgentSession(root, c.id, 'codex')).toBeNull();
    saveAgentSession(root, handle(c.id));
    clearAgentSession(root, c.id, 'claude');
    expect(getAgentSession(root, c.id, 'claude')).toBeNull();
  });
});

describe('archive', () => {
  it('auto-archives threads untouched for 7+ days on list read', () => {
    const c = createConversation(root);
    const db = openChatDb(root);
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
      new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      c.id,
    );
    expect(listConversations(root).find(x => x.id === c.id)?.archived).toBe(true);
    // Fresh threads stay put.
    const fresh = createConversation(root);
    expect(listConversations(root).find(x => x.id === fresh.id)?.archived).toBe(false);
  });

  it('setConversationArchived flips the flag and listConversations still returns the row', () => {
    const c = createConversation(root, { title: 'to archive' });
    setConversationArchived(root, c.id, true);
    const listed = listConversations(root).find(x => x.id === c.id);
    expect(listed?.archived).toBe(true);
    setConversationArchived(root, c.id, false);
    expect(listConversations(root).find(x => x.id === c.id)?.archived).toBe(false);
  });
});
