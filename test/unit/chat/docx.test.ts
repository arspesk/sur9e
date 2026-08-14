import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractDocxText } from '@/lib/server/chat/docx';

describe('extractDocxText', () => {
  it('extracts plain text from a .docx buffer', async () => {
    const buf = readFileSync(join(process.cwd(), 'test/fixtures/sample.docx'));
    const text = await extractDocxText(buf);
    expect(text).toContain('Customer Solutions Engineer JD');
    expect(text).toContain('Remote-first fintech role.');
    // OOXML/zip internals must not leak into the extracted text.
    expect(text).not.toContain('<w:');
  });
});
