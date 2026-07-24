import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeChatDb, openChatDb } from '@/lib/server/chat/db';
import { ensureColumn, runMigrations } from '@/lib/server/chat/migrations';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-db-'));
});

afterEach(() => {
  closeChatDb(root);
  rmSync(root, { recursive: true, force: true });
});

describe('openChatDb', () => {
  it('creates data/chat.db under the root and enables WAL', () => {
    const db = openChatDb(root);
    expect(existsSync(join(root, 'data', 'chat.db'))).toBe(true);
    const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(mode.journal_mode).toBe('wal');
  });

  it('creates the three tables and the messages index', () => {
    const db = openChatDb(root);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')")
      .all() as Array<{ name: string }>;
    const names = rows.map(r => r.name);
    expect(names).toContain('conversations');
    expect(names).toContain('messages');
    expect(names).toContain('agent_sessions');
    expect(names).toContain('idx_messages_conv');
  });

  it('returns the same handle for the same root, distinct handles per root', () => {
    const other = mkdtempSync(join(tmpdir(), 'chat-db2-'));
    try {
      expect(openChatDb(root)).toBe(openChatDb(root));
      expect(openChatDb(root)).not.toBe(openChatDb(other));
    } finally {
      closeChatDb(other);
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('migrations are idempotent — running twice does not throw', () => {
    const db = openChatDb(root);
    expect(() => runMigrations(db)).not.toThrow();
  });
});

describe('ensureColumn', () => {
  it('adds a missing column once and is a no-op when present', () => {
    const db = openChatDb(root);
    db.exec('CREATE TABLE IF NOT EXISTS scratch (id TEXT PRIMARY KEY)');
    ensureColumn(db, 'scratch', 'extra', 'extra TEXT');
    ensureColumn(db, 'scratch', 'extra', 'extra TEXT'); // second call must not throw
    const cols = db.prepare('PRAGMA table_info(scratch)').all() as Array<{ name: string }>;
    expect(cols.filter(c => c.name === 'extra')).toHaveLength(1);
  });
});
