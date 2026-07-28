import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('layout-mirroring route loading boundaries', () => {
  it('provides a Home-only loading boundary without affecting sibling routes', () => {
    expect(existsSync('src/app/(home)/page.tsx')).toBe(true);
    expect(existsSync('src/app/(home)/loading.tsx')).toBe(true);
    expect(existsSync('src/app/loading.tsx')).toBe(false);
  });

  it('provides a Chat loading boundary shared by /chat and /chat/[id]', () => {
    expect(existsSync('src/app/chat/loading.tsx')).toBe(true);
  });
});
