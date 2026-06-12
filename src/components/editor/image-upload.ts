// Shared image-upload helpers used by the slash menu, drag/drop, and
// clipboard-paste paths in the TipTap editor. Posts each file to
// /api/output/inline (multipart) and inserts an <img> node at the given
// position. Multiple files are inserted in order; failures are logged but
// don't block subsequent uploads.

import type { Editor as TiptapEditor } from '@tiptap/core';

interface UploadResult {
  url: string;
}

async function uploadOne(file: File): Promise<UploadResult | null> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/output/inline', { method: 'POST', body: fd });
  if (!res.ok) {
    console.error('[image-upload] failed', res.status, file.name);
    return null;
  }
  return res.json();
}

/**
 * Upload one or more image files, then insert them as <img> nodes starting
 * at `insertPos`. Each successive image is inserted right after the
 * previous one so a multi-image drop renders in source order.
 */
export async function uploadAndInsertImages(
  editor: TiptapEditor,
  files: File[],
  insertPos: number,
): Promise<void> {
  const filtered = files.filter(f => f.type.startsWith('image/'));
  if (filtered.length === 0) return;
  let cursor = insertPos;
  for (const file of filtered) {
    const r = await uploadOne(file);
    if (!r) continue;
    editor
      .chain()
      .focus()
      .insertContentAt(cursor, {
        type: 'image',
        attrs: { src: r.url, alt: file.name },
      })
      .run();
    // Advance the cursor so the next image lands AFTER this one rather
    // than overwriting it. Image is an inline atom, so size 1.
    cursor += 1;
  }
}
