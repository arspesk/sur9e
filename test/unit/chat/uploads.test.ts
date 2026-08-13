import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveChatUploadPath, saveChatUpload } from '@/lib/server/chat/uploads';

const CONV = '11111111-2222-4333-8444-555555555555';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-uploads-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('saveChatUpload', () => {
  it('writes under data/chat/uploads/<conv>/ and returns metadata', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
    const att = await saveChatUpload(root, CONV, file);
    expect(att.name).toBe('shot.png');
    expect(att.mime).toBe('image/png');
    expect(att.size).toBe(3);
    expect(att.path).toMatch(new RegExp(`^${CONV}/[0-9a-f-]{36}\\.png$`));
    expect(existsSync(join(root, 'data', 'chat', 'uploads', att.path))).toBe(true);
  });

  it('rejects a disallowed extension', async () => {
    const file = new File([new Uint8Array([1])], 'run.exe', { type: 'application/x-msdownload' });
    await expect(saveChatUpload(root, CONV, file)).rejects.toThrow(/not allowed/i);
  });

  it('rejects a file over 10MB', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await expect(saveChatUpload(root, CONV, big)).rejects.toThrow(/too large/i);
  });

  it('converts a .docx to readable text so the agent can consume it', async () => {
    const bytes = readFileSync(join(process.cwd(), 'test/fixtures/sample.docx'));
    const file = new File([bytes], 'Customer_Solutions_Engineer_JD.docx');
    const att = await saveChatUpload(root, CONV, file);
    // Chip keeps the original name; the stored artifact is text the CLI reads.
    expect(att.name).toBe('Customer_Solutions_Engineer_JD.docx');
    expect(att.mime).toBe('text/markdown');
    expect(att.path).toMatch(new RegExp(`^${CONV}/[0-9a-f-]{36}\\.md$`));
    const stored = readFileSync(join(root, 'data', 'chat', 'uploads', att.path), 'utf-8');
    expect(stored).toContain('Customer Solutions Engineer JD');
    expect(stored).not.toContain('<w:');
  });
});

describe('resolveChatUploadPath', () => {
  it('resolves a stored path and refuses traversal or unknown shapes', async () => {
    const file = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });
    const att = await saveChatUpload(root, CONV, file);
    const hit = resolveChatUploadPath(root, att.path);
    expect(hit?.mime).toBe('application/pdf');
    expect(hit?.absPath).toBe(join(root, 'data', 'chat', 'uploads', att.path));
    expect(resolveChatUploadPath(root, '../secrets.txt')).toBeNull();
    expect(resolveChatUploadPath(root, `${CONV}/../../x.png`)).toBeNull();
    expect(resolveChatUploadPath(root, `${CONV}/nope.png`)).toBeNull();
  });
});
