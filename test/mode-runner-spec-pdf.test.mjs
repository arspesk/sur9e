// test/mode-runner-spec-pdf.test.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coverLetterSpec, tailorCvSpec } from '../batch/specs/pdf.mjs';

// loadInputs fetches the offer URL for the JD. Never hit the live network from
// a unit test — same hazard that made the evaluate-spec tests flake on CI.
vi.mock('../batch/jd-fetcher.mjs', () => ({
  fetchJobDescription: vi.fn(async () => ({
    text: 'MOCK JD TEXT',
    status: 'ok',
    httpStatus: 200,
  })),
}));

let root;
let ctx;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdf-spec-'));
  for (const d of [
    'data',
    'artifacts/reports',
    'artifacts/output',
    'inputs/personalization',
    'content/modes',
    'content/templates',
  ]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  writeFileSync(join(root, 'inputs/personalization/cv.md'), '# CV', 'utf-8');
  writeFileSync(
    join(root, 'inputs/personalization/profile.yml'),
    'candidate:\n  full_name: John Doe',
    'utf-8',
  );
  writeFileSync(join(root, 'content/modes/tailor-cv.md'), '# tailor-cv mode', 'utf-8');
  writeFileSync(join(root, 'content/modes/cover-letter.md'), '# cover-letter mode', 'utf-8');
  writeFileSync(
    join(root, 'content/templates/cv-template.html'),
    '<html>CV {{name}}</html>',
    'utf-8',
  );
  writeFileSync(
    join(root, 'content/templates/cover-letter-template.html'),
    '<html>CL {{name}}</html>',
    'utf-8',
  );
  writeFileSync(
    join(root, 'data/applications.md'),
    '| 7 | 2026-06-01 | Otter.ai | SE | 4.2/5 | Evaluated | ❌ | [7](artifacts/reports/007-otter-ai-2026-06-01.md) | ok |',
    'utf-8',
  );
  writeFileSync(
    join(root, 'artifacts/reports/007-otter-ai-2026-06-01.md'),
    '---\nnum: 7\ncompany: Otter.ai\nurl: https://otter.ai/jobs/1\nscore: 4.2\n---\n\n## TL;DR\n\nok\n',
    'utf-8',
  );
  ctx = { rootPath: root, num: 7 };
});

const PAYLOAD = `format: letter\n<!DOCTYPE html>\n<html><body>tailored</body></html>`;

describe('pdf specs', () => {
  it('parse splits format line and html document', () => {
    const out = tailorCvSpec.parse(`<<<SUR9E_OUTPUT>>>\n${PAYLOAD}\n<<<SUR9E_END>>>`);
    expect(out.format).toBe('letter');
    expect(out.html).toContain('<!DOCTYPE html>');
  });

  it('parse rejects an invalid format token', () => {
    expect(() =>
      tailorCvSpec.parse('<<<SUR9E_OUTPUT>>>\nformat: tabloid\n<html></html>\n<<<SUR9E_END>>>'),
    ).toThrow(/format/);
  });

  it('parse rejects a payload that is not an html document', () => {
    expect(() =>
      tailorCvSpec.parse('<<<SUR9E_OUTPUT>>>\nformat: a4\nnot html at all\n<<<SUR9E_END>>>'),
    ).toThrow(/html/i);
  });

  it('tailor-cv write produces the slugged pdf path via the injected pdf builder', async () => {
    const calls = [];
    const fakePdf = vi.fn((htmlPath, pdfPath, format) => {
      calls.push({ htmlPath, pdfPath, format, html: readFileSync(htmlPath, 'utf-8') });
      writeFileSync(pdfPath, 'PDF', 'utf-8'); // simulate success
    });
    const inputs = await tailorCvSpec.loadInputs(ctx);
    const payload = tailorCvSpec.parse(`<<<SUR9E_OUTPUT>>>\n${PAYLOAD}\n<<<SUR9E_END>>>`);
    const { summary } = await tailorCvSpec.write(ctx, inputs, payload, { pdfImpl: fakePdf });

    const today = new Date().toISOString().slice(0, 10);
    // The offer num (ctx.num = 7) sits between the slug and the date.
    const expected = join(root, `artifacts/output/cv-john-doe-otter-ai-7-${today}.pdf`);
    expect(calls[0].pdfPath).toBe(expected);
    expect(calls[0].format).toBe('letter');
    expect(calls[0].html).toContain('tailored');
    expect(summary).toContain('otter-ai');
  });

  it('tailor-cv write flips the tracker PDF cell to ✅', async () => {
    const fakePdf = vi.fn((h, pdfPath) => writeFileSync(pdfPath, 'PDF', 'utf-8'));
    const inputs = await tailorCvSpec.loadInputs(ctx);
    const payload = tailorCvSpec.parse(`<<<SUR9E_OUTPUT>>>\n${PAYLOAD}\n<<<SUR9E_END>>>`);
    const { summary } = await tailorCvSpec.write(ctx, inputs, payload, { pdfImpl: fakePdf });
    expect(summary).toContain('tracker PDF cell ✅');
    const tracker = readFileSync(join(root, 'data/applications.md'), 'utf-8');
    expect(tracker).toContain('| ✅ |');
    expect(tracker).not.toContain('❌');
  });

  it('cover-letter write leaves the tracker PDF cell alone', async () => {
    const fakePdf = vi.fn((h, pdfPath) => writeFileSync(pdfPath, 'PDF', 'utf-8'));
    const inputs = await coverLetterSpec.loadInputs(ctx);
    const payload = coverLetterSpec.parse(`<<<SUR9E_OUTPUT>>>\n${PAYLOAD}\n<<<SUR9E_END>>>`);
    const { summary } = await coverLetterSpec.write(ctx, inputs, payload, { pdfImpl: fakePdf });
    expect(summary).not.toContain('tracker');
    expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toContain('❌');
  });

  it('cover-letter write uses the cover-letter- filename prefix', async () => {
    const fakePdf = vi.fn((h, pdfPath) => writeFileSync(pdfPath, 'PDF', 'utf-8'));
    const inputs = await coverLetterSpec.loadInputs(ctx);
    const payload = coverLetterSpec.parse(`<<<SUR9E_OUTPUT>>>\n${PAYLOAD}\n<<<SUR9E_END>>>`);
    await coverLetterSpec.write(ctx, inputs, payload, { pdfImpl: fakePdf });
    const today = new Date().toISOString().slice(0, 10);
    expect(
      existsSync(join(root, `artifacts/output/cover-letter-john-doe-otter-ai-7-${today}.pdf`)),
    ).toBe(true);
  });

  it('write throws when the pdf builder fails to produce the file', async () => {
    const fakePdf = vi.fn(); // produces nothing
    const inputs = await tailorCvSpec.loadInputs(ctx);
    const payload = tailorCvSpec.parse(`<<<SUR9E_OUTPUT>>>\n${PAYLOAD}\n<<<SUR9E_END>>>`);
    await expect(tailorCvSpec.write(ctx, inputs, payload, { pdfImpl: fakePdf })).rejects.toThrow(
      /pdf/i,
    );
  });
});
