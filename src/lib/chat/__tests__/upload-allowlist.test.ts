import { describe, expect, it } from 'vitest';
import { CHAT_UPLOAD_ACCEPT, isAllowedUploadFile, validateChatFiles } from '../upload-allowlist';

function file(name: string, sizeBytes = 10): File {
  return new File([new Uint8Array(sizeBytes)], name);
}

describe('upload allowlist', () => {
  it('accepts docx now that it is supported', () => {
    expect(isAllowedUploadFile('Customer_Solutions_Engineer_JD.docx')).toBe(true);
  });
  it('rejects unsupported types', () => {
    expect(isAllowedUploadFile('archive.zip')).toBe(false);
    expect(isAllowedUploadFile('noextension')).toBe(false);
  });
  it('accept string lists image, pdf, and docx extensions', () => {
    expect(CHAT_UPLOAD_ACCEPT).toContain('.docx');
    expect(CHAT_UPLOAD_ACCEPT).toContain('.pdf');
    expect(CHAT_UPLOAD_ACCEPT).toContain('.png');
  });
});

describe('validateChatFiles', () => {
  it('accepts supported files with no message', () => {
    const r = validateChatFiles([file('jd.docx'), file('a.pdf')], 0);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected).toHaveLength(0);
    expect(r.message).toBeNull();
  });

  it('rejects an unsupported type before staging with a clear, typed message', () => {
    const r = validateChatFiles([file('archive.zip')], 0);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.message).toBeTruthy();
    expect(r.message).toMatch(/DOCX|PDF/i); // message lists accepted types
  });

  it('rejects files beyond the 8-file limit, counting what is already staged', () => {
    const many = Array.from({ length: 3 }, (_, i) => file(`f${i}.pdf`));
    const r = validateChatFiles(many, 7); // 7 staged + max 8 → 1 slot left
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(2);
    expect(r.message).toBeTruthy();
  });

  it('rejects an oversized file', () => {
    const r = validateChatFiles([file('huge.pdf', 11 * 1024 * 1024)], 0);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.message).toBeTruthy();
  });
});
