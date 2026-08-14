// Client-safe (no `server-only`) attachment allowlist + validator, shared by
// the composer's picker/paste/drop paths AND the server upload route, so all
// entry points agree on what can be attached. The drag-and-drop path used to
// bypass the picker's filter, staging unsupported files that only failed after
// send with a non-actionable Retry (issue #73).
//
// Extension → declared/served MIME. MIME always derives from the extension,
// never from the client-supplied File.type. `.docx` is accepted here and
// converted to text server-side (see src/lib/server/chat/docx.ts) so it
// actually reaches the agent.
export const CHAT_UPLOAD_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export const CHAT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_UPLOAD_MAX_FILES = 8;

/** input[accept] / drag-filter string for the client. */
export const CHAT_UPLOAD_ACCEPT = Object.keys(CHAT_UPLOAD_EXTENSIONS)
  .map(e => `.${e}`)
  .join(',');

/** Human-readable accepted-types list for reject messages. */
export const CHAT_UPLOAD_ACCEPT_LABEL = 'PNG, JPG, WEBP, GIF, PDF, TXT, MD, DOCX';

export function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function isAllowedUploadFile(name: string): boolean {
  const ext = extensionOf(name);
  return ext !== name.toLowerCase() && Object.hasOwn(CHAT_UPLOAD_EXTENSIONS, ext);
}

export interface UploadValidation {
  accepted: File[];
  rejected: File[];
  /** User-facing summary of what was rejected, or null when nothing was. */
  message: string | null;
}

/**
 * Partition an incoming file list into what can be staged vs. rejected, given
 * how many files are already staged. Reasons are deduplicated into one clear
 * message that names the accepted types.
 */
export function validateChatFiles(incoming: File[], existingCount: number): UploadValidation {
  const accepted: File[] = [];
  const rejected: File[] = [];
  const reasons = new Set<string>();
  let slots = Math.max(0, CHAT_UPLOAD_MAX_FILES - existingCount);

  for (const file of incoming) {
    if (!isAllowedUploadFile(file.name)) {
      rejected.push(file);
      reasons.add(`unsupported type (accepted: ${CHAT_UPLOAD_ACCEPT_LABEL})`);
    } else if (file.size > CHAT_UPLOAD_MAX_BYTES) {
      rejected.push(file);
      reasons.add('over the 10 MB limit');
    } else if (slots <= 0) {
      rejected.push(file);
      reasons.add(`over the ${CHAT_UPLOAD_MAX_FILES}-file limit`);
    } else {
      accepted.push(file);
      slots--;
    }
  }

  const message = rejected.length
    ? `Couldn't attach ${rejected.length} file${rejected.length > 1 ? 's' : ''}: ${[...reasons].join('; ')}.`
    : null;
  return { accepted, rejected, message };
}
