import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { latexSpec } from '../batch/specs/latex.mjs';

let root;
let ctx;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'latex-spec-'));
  mkdirSync(join(root, 'artifacts/output'), { recursive: true });
  ctx = { rootPath: root, num: 7 };
});

const TEX = String.raw`\documentclass{article}
\begin{document}
Hello
\end{document}`;

describe('latex mode spec', () => {
  it('parses a sentinel-wrapped tex document', () => {
    expect(latexSpec.parse(`<<<SUR9E_OUTPUT>>>\n${TEX}\n<<<SUR9E_END>>>`)).toContain(
      '\\begin{document}',
    );
  });

  it('rejects non-LaTeX output', () => {
    expect(() => latexSpec.parse('<<<SUR9E_OUTPUT>>>\nplain text\n<<<SUR9E_END>>>')).toThrow(
      /latex/i,
    );
  });

  it('writes a distinct cv-latex artifact and invokes the compiler', async () => {
    const compile = vi.fn((texPath, pdfPath) => {
      expect(readFileSync(texPath, 'utf-8')).toContain('\\documentclass');
      writeFileSync(pdfPath, 'PDF', 'utf-8');
    });
    const inputs = {
      offer: { company: 'Otter.ai' },
      profile: { candidate: { full_name: 'John Doe' } },
    };

    const result = await latexSpec.write(ctx, inputs, TEX, { compile });

    expect(compile).toHaveBeenCalledOnce();
    expect(result.summary).toContain('artifacts/output/cv-latex-john-doe-otter-ai-7-');
  });
});
