import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOfferSource } from '../batch/lib/offer-source.mjs';

describe('resolveOfferSource', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('fetches URL-backed offers through the existing fetcher', async () => {
    const fetcher = vi.fn(async url => ({ status: 'ok', text: `Fetched ${url}` }));
    const result = await resolveOfferSource(
      '/tmp/unused',
      { url: 'https://example.com/jobs/1' },
      { fetcher },
    );
    expect(fetcher).toHaveBeenCalledWith('https://example.com/jobs/1');
    expect(result).toEqual({
      kind: 'url',
      label: 'https://example.com/jobs/1',
      jd: { status: 'ok', text: 'Fetched https://example.com/jobs/1' },
    });
  });

  it('reads a saved text source without calling the network', async () => {
    root = mkdtempSync(join(tmpdir(), 'offer-source-'));
    mkdirSync(join(root, 'inputs/jds'), { recursive: true });
    writeFileSync(join(root, 'inputs/jds/acme.md'), 'Pasted JD\n', 'utf-8');
    const fetcher = vi.fn();
    const result = await resolveOfferSource(
      root,
      { sourceKind: 'text', jdPath: 'inputs/jds/acme.md' },
      { fetcher },
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: 'text',
      label: 'Saved pasted job description',
      jd: { status: 'ok', text: 'Pasted JD\n' },
    });
  });

  it('rejects a saved source path outside inputs/jds', async () => {
    root = mkdtempSync(join(tmpdir(), 'offer-source-'));
    await expect(
      resolveOfferSource(root, {
        sourceKind: 'text',
        jdPath: '../secrets.txt',
      }),
    ).rejects.toThrow('invalid saved JD path');
  });
});
