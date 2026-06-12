import { describe, expect, it } from 'vitest';
import { inlineImageMimeForName, isAllowedInlineImageMime } from '../inline-uploads';

describe('inline-uploads allowlist', () => {
  it('maps allowed raster image extensions to a safe MIME', () => {
    expect(inlineImageMimeForName('a.png')).toBe('image/png');
    expect(inlineImageMimeForName('a.JPG')).toBe('image/jpeg');
    expect(inlineImageMimeForName('a.jpeg')).toBe('image/jpeg');
    expect(inlineImageMimeForName('a.gif')).toBe('image/gif');
    expect(inlineImageMimeForName('photo.webp')).toBe('image/webp');
  });

  it('rejects script-capable / document types (stored-XSS vectors)', () => {
    expect(inlineImageMimeForName('x.svg')).toBeNull();
    expect(inlineImageMimeForName('x.html')).toBeNull();
    expect(inlineImageMimeForName('x.xml')).toBeNull();
    expect(inlineImageMimeForName('x.xhtml')).toBeNull();
    expect(inlineImageMimeForName('noext')).toBeNull();
    expect(inlineImageMimeForName('trick.png.html')).toBeNull();
  });

  it('validates a declared upload MIME against the raster-image allowlist', () => {
    expect(isAllowedInlineImageMime('image/png')).toBe(true);
    expect(isAllowedInlineImageMime('image/webp')).toBe(true);
    expect(isAllowedInlineImageMime('image/svg+xml')).toBe(false);
    expect(isAllowedInlineImageMime('text/html')).toBe(false);
    expect(isAllowedInlineImageMime('')).toBe(false);
  });
});
