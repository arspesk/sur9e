// src/lib/server/chat/migrations.ts
//
// Idempotent schema migrations for data/chat.db (design spec §3.3).
// Open Design pattern: CREATE TABLE IF NOT EXISTS for the base shape,
// PRAGMA table_info–guarded ALTERs (ensureColumn) for later additions.
// runMigrations executes on every openChatDb — it must stay cheap and
// safe to re-run.

import 'server-only';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Add `column` to `table` unless it already exists. This is the extension
 * point future migrations use — SQLite has no ALTER TABLE IF NOT EXISTS,
 * so we guard with PRAGMA table_info. `table`/`ddl` are always literals
 * from this file, never user input.
 */
export function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some(c => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mode TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      events_json TEXT,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, position)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      conversation_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      cwd TEXT NOT NULL,
      last_message_id TEXT,
      PRIMARY KEY (conversation_id, provider)
    )
  `);
  // Task 3 (chat refinement): who last set the title. NULL/'auto' = machine
  // (fallback or AI titler, safe to overwrite), 'manual' = user rename (never
  // auto-overwritten).
  ensureColumn(db, 'conversations', 'title_source', 'title_source TEXT');
  // Task 7: regenerated replies join a version group; only the latest member
  // participates in later prompt context.
  ensureColumn(db, 'messages', 'version_group', 'version_group TEXT');
  // Task 9: user-message attachments, [{path,name,mime,size}] JSON.
  ensureColumn(db, 'messages', 'attachments_json', 'attachments_json TEXT');
  // Task 10: offer nums @-mentioned in a user message, [3,48] JSON.
  ensureColumn(db, 'messages', 'referenced_offers_json', 'referenced_offers_json TEXT');
}
