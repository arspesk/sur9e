// src/lib/server/chat/uploads.ts
//
// Attachment storage for chat messages. Files land under
// data/chat/uploads/<conversationId>/<uuid>.<ext> (data/* is gitignored).
// The stored `path` is RELATIVE to that uploads root; resolveChatUploadPath
// is the only way back to an absolute path and doubles as the traversal
// guard for the file-serving route.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ChatAttachment } from '../../schemas/chat';

/** Extension allowlist → served/declared MIME. Mime derives from the
 * extension, never from the client-supplied File.type. */
export const CHAT_UPLOAD_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
};

export const CHAT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_UPLOAD_MAX_FILES = 8;

/** input[accept] / drag-filter string for the client. */
export const CHAT_UPLOAD_ACCEPT = Object.keys(CHAT_UPLOAD_EXTENSIONS)
  .map(e => `.${e}`)
  .join(',');

export function uploadsDir(root: string): string {
  return join(root, 'data', 'chat', 'uploads');
}

export async function saveChatUpload(
  root: string,
  conversationId: string,
  file: File,
): Promise<ChatAttachment> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = CHAT_UPLOAD_EXTENSIONS[ext];
  if (!mime) throw new Error(`file type not allowed: ${file.name}`);
  if (file.size > CHAT_UPLOAD_MAX_BYTES) throw new Error(`file too large (max 10MB): ${file.name}`);
  const dir = join(uploadsDir(root), conversationId);
  mkdirSync(dir, { recursive: true });
  const stored = `${randomUUID()}.${ext}`;
  writeFileSync(join(dir, stored), Buffer.from(await file.arrayBuffer()));
  return { path: `${conversationId}/${stored}`, name: file.name, mime, size: file.size };
}

// <conversation uuid>/<stored uuid>.<allowlisted ext> — nothing else resolves.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const REL_RE = new RegExp(`^${UUID}/${UUID}\\.([a-z0-9]+)$`);

export function resolveChatUploadPath(
  root: string,
  relPath: string,
): { absPath: string; mime: string } | null {
  const m = REL_RE.exec(relPath);
  if (!m) return null;
  const mime = CHAT_UPLOAD_EXTENSIONS[m[1]];
  if (!mime) return null;
  const base = uploadsDir(root);
  const abs = join(base, relPath);
  if (!abs.startsWith(base + sep)) return null; // belt & suspenders after the regex
  return existsSync(abs) ? { absPath: abs, mime } : null;
}
