// src/lib/server/chat/store.ts
//
// CRUD over data/chat.db — the only module that speaks SQL. Every row is
// parsed through the lib/schemas/chat zod schemas at the read boundary
// (same discipline as jobs/api.ts with JobRecord), so callers always see
// validated camelCase shapes, never raw snake_case rows.

import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  AgentSessionHandle,
  type ChatAttachment,
  ChatMessage,
  Conversation,
} from '../../schemas/chat';
import { openChatDb } from './db';

type ConversationRow = {
  id: string;
  title: string;
  title_source: string | null;
  mode: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  events_json: string | null;
  version_group: string | null;
  attachments_json: string | null;
  referenced_offers_json: string | null;
  position: number;
  created_at: string;
};

type AgentSessionRow = {
  conversation_id: string;
  provider: string;
  provider_session_id: string;
  model: string;
  cwd: string;
  last_message_id: string | null;
};

function toConversation(row: ConversationRow): Conversation {
  return Conversation.parse({
    id: row.id,
    title: row.title,
    titleSource: row.title_source ?? null,
    mode: row.mode,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseEvents(json: string | null): unknown[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // A corrupt events blob must never make the message unreadable.
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseAttachments(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    // A corrupt blob must never make the message unreadable.
    return null;
  }
}

function toMessage(row: MessageRow): ChatMessage {
  return ChatMessage.parse({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    events: parseEvents(row.events_json),
    versionGroup: row.version_group ?? null,
    attachments: parseAttachments(row.attachments_json),
    referencedOffers: parseAttachments(row.referenced_offers_json),
    position: row.position,
    createdAt: row.created_at,
  });
}

function toAgentSession(row: AgentSessionRow): AgentSessionHandle {
  return AgentSessionHandle.parse({
    conversationId: row.conversation_id,
    provider: row.provider,
    providerSessionId: row.provider_session_id,
    model: row.model,
    cwd: row.cwd,
    lastMessageId: row.last_message_id,
  });
}

export function createConversation(
  root: string,
  opts?: { title?: string; mode?: string },
): Conversation {
  const db = openChatDb(root);
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO conversations (id, title, mode, archived, created_at, updated_at, title_source)
     VALUES (?, ?, ?, 0, ?, ?, NULL)`,
  ).run(id, opts?.title ?? 'New chat', opts?.mode ?? null, now, now);
  return toConversation({
    id,
    title: opts?.title ?? 'New chat',
    title_source: null,
    mode: opts?.mode ?? null,
    archived: 0,
    created_at: now,
    updated_at: now,
  });
}

/** Returns ALL conversations, archived included — the client filters
 * `archived` (recent list vs the collapsed Archived section). */
/** Threads untouched for this long auto-archive on the next list read. */
const AUTO_ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function listConversations(root: string): Conversation[] {
  const db = openChatDb(root);
  // Lazy auto-archive: stale threads drop out of the recent list on read
  // (still reachable — and unarchivable — from the Archived section).
  const cutoff = new Date(Date.now() - AUTO_ARCHIVE_AFTER_MS).toISOString();
  db.prepare('UPDATE conversations SET archived = 1 WHERE archived = 0 AND updated_at < ?').run(
    cutoff,
  );
  const rows = db
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as ConversationRow[];
  return rows.map(toConversation);
}

export function getConversation(root: string, id: string): Conversation | null {
  const db = openChatDb(root);
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | ConversationRow
    | undefined;
  return row ? toConversation(row) : null;
}

export function renameConversation(root: string, id: string, title: string): void {
  const db = openChatDb(root);
  db.prepare(
    "UPDATE conversations SET title = ?, title_source = 'manual', updated_at = ? WHERE id = ?",
  ).run(title, new Date().toISOString(), id);
}

/** Machine title write (fallback or AI titler). Refuses once the user has
 * renamed manually. Returns true when a row was updated. */
export function setAutoTitle(root: string, id: string, title: string): boolean {
  const db = openChatDb(root);
  const res = db
    .prepare(
      `UPDATE conversations SET title = ?, title_source = 'auto', updated_at = ?
       WHERE id = ? AND (title_source IS NULL OR title_source = 'auto')`,
    )
    .run(title, new Date().toISOString(), id);
  return Number(res.changes) > 0;
}

export function setConversationArchived(root: string, id: string, archived: boolean): void {
  const db = openChatDb(root);
  db.prepare('UPDATE conversations SET archived = ?, updated_at = ? WHERE id = ?').run(
    archived ? 1 : 0,
    new Date().toISOString(),
    id,
  );
}

export function deleteConversation(root: string, id: string): void {
  const db = openChatDb(root);
  // The schema declares REFERENCES without ON DELETE CASCADE (and SQLite's
  // foreign_keys pragma is off by default), so cascade explicitly, child
  // rows first, inside one transaction.
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM agent_sessions WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function appendMessage(
  root: string,
  msg: {
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    events?: unknown[];
    versionGroup?: string | null;
    attachments?: ChatAttachment[];
    referencedOffers?: number[];
  },
): ChatMessage {
  const db = openChatDb(root);
  if (!getConversation(root, msg.conversationId)) {
    throw new Error(`conversation not found: ${msg.conversationId}`);
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  const next = db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM messages WHERE conversation_id = ?',
    )
    .get(msg.conversationId) as { next: number };
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, events_json, position, created_at, version_group, attachments_json, referenced_offers_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    msg.conversationId,
    msg.role,
    msg.content,
    msg.events ? JSON.stringify(msg.events) : null,
    next.next,
    now,
    msg.versionGroup ?? null,
    msg.attachments ? JSON.stringify(msg.attachments) : null,
    msg.referencedOffers ? JSON.stringify(msg.referencedOffers) : null,
  );
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, msg.conversationId);
  return ChatMessage.parse({
    id,
    conversationId: msg.conversationId,
    role: msg.role,
    content: msg.content,
    events: msg.events ?? null,
    versionGroup: msg.versionGroup ?? null,
    attachments: msg.attachments ?? null,
    referencedOffers: msg.referencedOffers ?? null,
    position: next.next,
    createdAt: now,
  });
}

/** Backfill a version group onto an existing message (first regeneration). */
export function setMessageVersionGroup(root: string, messageId: string, group: string): void {
  const db = openChatDb(root);
  db.prepare('UPDATE messages SET version_group = ? WHERE id = ?').run(group, messageId);
}

/**
 * Persist a confirm-resolved outcome onto the assistant message that owns a
 * confirm token.
 *
 * A turn's events_json is written once, at 'done'. But the user usually clicks
 * Approve/Cancel on the inline confirm card AFTER the turn already finished, so
 * that confirm-resolved event only ever reaches the live SSE stream — never the
 * stored message. On reload foldEvents then re-processes the persisted events,
 * sees the original {type:'confirm'} (outcome pending), and re-renders active
 * Start/Cancel buttons for an action that already ran. This appends the
 * {type:'confirm-resolved', token, outcome} event to that message so the
 * resolved state survives a reload.
 *
 * The owning message is the assistant one whose events_json carries the
 * matching {type:'confirm', token} event. The token is a process-unique uuid,
 * so a global scan (no conversation/turn context needed) can't mismatch — and
 * it keeps working even when the live turn is already gone (terminal/expired
 * resolves still persist, since confirms outlive their turn's SSE stream).
 *
 * Idempotent: a token already carrying a confirm-resolved is left as-is, so a
 * double-resolve (a real outcome followed by a stale 'expired') never clobbers
 * the first. A corrupt/missing events blob is skipped, never rewritten. Returns
 * true when a message already had, or now has, the resolution recorded.
 */
export function appendConfirmResolution(
  root: string,
  token: string,
  outcome: 'approved' | 'cancelled' | 'expired',
): boolean {
  const db = openChatDb(root);
  const rows = db
    .prepare(
      "SELECT id, events_json FROM messages WHERE role = 'assistant' AND events_json LIKE ? ORDER BY position DESC",
    )
    .all(`%${token}%`) as { id: string; events_json: string | null }[];
  for (const row of rows) {
    const events = parseEvents(row.events_json);
    if (!events) continue;
    // Verify the LIKE hit is the real owner (the confirm event carrying this
    // token), not an incidental substring match elsewhere in the blob.
    const owns = events.some(e => isRecord(e) && e.type === 'confirm' && e.token === token);
    if (!owns) continue;
    const alreadyResolved = events.some(
      e => isRecord(e) && e.type === 'confirm-resolved' && e.token === token,
    );
    if (alreadyResolved) return true;
    // Seq after the current max so foldEvents' seq-sort keeps the resolution
    // last (it flips the confirm item in place regardless, but order is tidy).
    const maxSeq = events.reduce<number>((m, e) => {
      const s = isRecord(e) ? e.seq : undefined;
      return typeof s === 'number' && s > m ? s : m;
    }, 0);
    events.push({ seq: maxSeq + 1, type: 'confirm-resolved', token, outcome });
    db.prepare('UPDATE messages SET events_json = ? WHERE id = ?').run(
      JSON.stringify(events),
      row.id,
    );
    return true;
  }
  return false;
}

export function listMessages(root: string, conversationId: string): ChatMessage[] {
  const db = openChatDb(root);
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY position ASC')
    .all(conversationId) as MessageRow[];
  return rows.map(toMessage);
}

export function getAgentSession(
  root: string,
  conversationId: string,
  provider: string,
): AgentSessionHandle | null {
  const db = openChatDb(root);
  const row = db
    .prepare('SELECT * FROM agent_sessions WHERE conversation_id = ? AND provider = ?')
    .get(conversationId, provider) as AgentSessionRow | undefined;
  return row ? toAgentSession(row) : null;
}

export function saveAgentSession(root: string, handle: AgentSessionHandle): void {
  const db = openChatDb(root);
  const h = AgentSessionHandle.parse(handle);
  db.prepare(
    `INSERT INTO agent_sessions
       (conversation_id, provider, provider_session_id, model, cwd, last_message_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (conversation_id, provider) DO UPDATE SET
       provider_session_id = excluded.provider_session_id,
       model = excluded.model,
       cwd = excluded.cwd,
       last_message_id = excluded.last_message_id`,
  ).run(h.conversationId, h.provider, h.providerSessionId, h.model, h.cwd, h.lastMessageId);
}

export function clearAgentSession(root: string, conversationId: string, provider: string): void {
  const db = openChatDb(root);
  db.prepare('DELETE FROM agent_sessions WHERE conversation_id = ? AND provider = ?').run(
    conversationId,
    provider,
  );
}
