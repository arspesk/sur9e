// src/lib/server/chat/db.ts
//
// One DatabaseSync handle per rootPath, at <root>/data/chat.db (data/ is
// gitignored runtime state). WAL mode; migrations run on open.
//
// The cache lives on globalThis, not at module level: Turbopack may
// instantiate this module once per route graph and re-evaluates it on HMR,
// so a module-level Map would open duplicate handles to the same file.
// Same dev-singleton pattern as the turn registry in turn-runner.ts.

import 'server-only';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations';

const cache: Map<string, DatabaseSync> = ((
  globalThis as unknown as { __sur9eChatDb?: Map<string, DatabaseSync> }
).__sur9eChatDb ??= new Map());

export function openChatDb(rootPath: string): DatabaseSync {
  const hit = cache.get(rootPath);
  if (hit) return hit;
  mkdirSync(join(rootPath, 'data'), { recursive: true });
  const db = new DatabaseSync(join(rootPath, 'data', 'chat.db'));
  db.exec('PRAGMA journal_mode=WAL');
  runMigrations(db);
  cache.set(rootPath, db);
  return db;
}

/**
 * Close and evict the handle for a root. Test helper — production code
 * keeps the handle open for the process lifetime.
 */
export function closeChatDb(rootPath: string): void {
  const db = cache.get(rootPath);
  if (!db) return;
  try {
    db.close();
  } catch {
    // already closed
  }
  cache.delete(rootPath);
}
