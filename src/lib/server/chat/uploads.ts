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
import {
  CHAT_UPLOAD_EXTENSIONS,
  CHAT_UPLOAD_MAX_BYTES,
  extensionOf,
  isAllowedUploadFile,
} from '../../chat/upload-allowlist';
import type { ChatAttachment } from '../../schemas/chat';
import { extractDocxText } from './docx';

// The extension allowlist / limits live in the client-safe shared module so
// the composer's picker/paste/drop paths validate identically to this route
// (issue #73). Re-export them to preserve this module's original public surface.
export {
  CHAT_UPLOAD_ACCEPT,
  CHAT_UPLOAD_EXTENSIONS,
  CHAT_UPLOAD_MAX_BYTES,
  CHAT_UPLOAD_MAX_FILES,
} from '../../chat/upload-allowlist';

export function uploadsDir(root: string): string {
  return join(root, 'data', 'chat', 'uploads');
}

export async function saveChatUpload(
  root: string,
  conversationId: string,
  file: File,
): Promise<ChatAttachment> {
  if (!isAllowedUploadFile(file.name)) throw new Error(`file type not allowed: ${file.name}`);
  if (file.size > CHAT_UPLOAD_MAX_BYTES) throw new Error(`file too large (max 10MB): ${file.name}`);
  const ext = extensionOf(file.name);
  const dir = join(uploadsDir(root), conversationId);
  mkdirSync(dir, { recursive: true });

  // Word docs can't be read by the provider's file tool, so convert to text at
  // rest and store as .md; the attachment chip keeps the original .docx name.
  if (ext === 'docx') {
    const text = await extractDocxText(Buffer.from(await file.arrayBuffer()));
    const stored = `${randomUUID()}.md`;
    const body = `${text}\n`;
    writeFileSync(join(dir, stored), body);
    return {
      path: `${conversationId}/${stored}`,
      name: file.name,
      mime: 'text/markdown',
      size: Buffer.byteLength(body),
    };
  }

  const stored = `${randomUUID()}.${ext}`;
  writeFileSync(join(dir, stored), Buffer.from(await file.arrayBuffer()));
  return {
    path: `${conversationId}/${stored}`,
    name: file.name,
    mime: CHAT_UPLOAD_EXTENSIONS[ext],
    size: file.size,
  };
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
