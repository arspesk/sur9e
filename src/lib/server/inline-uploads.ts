import 'server-only';

// Allowlist for the editor's inline image-upload routes
// (src/app/api/output/inline/*). Only raster images are accepted on upload and
// served on read. SVG, HTML, and XML are deliberately excluded: served
// same-origin they can execute script (stored XSS). The GET route also sends
// `nosniff` + a sandbox CSP so a stray non-image can never run.

const INLINE_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const ALLOWED_MIME = new Set(Object.values(INLINE_IMAGE_MIME));

/** Map a filename's extension to a safe image MIME, or null when not allowed. */
export function inlineImageMimeForName(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return INLINE_IMAGE_MIME[ext] ?? null;
}

/** True when an uploaded file's declared MIME is an allowed raster image type. */
export function isAllowedInlineImageMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}
