import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseReportFile } from '../batch/lib/report-file.mjs';
import { runTextScreen } from '../batch/screen-text.mjs';

describe('screen-text', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('runs the real screen contract against saved text and preserves source metadata', async () => {
    root = mkdtempSync(join(tmpdir(), 'screen-text-'));
    for (const dir of [
      'data',
      'inputs/jds',
      'inputs/personalization',
      'inputs/config',
      'content/modes',
      'artifacts/reports',
      'batch/tracker-additions',
    ]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    writeFileSync(join(root, 'inputs/jds/hash.md'), 'Build reliable systems.\n', 'utf-8');
    writeFileSync(join(root, 'inputs/personalization/cv.md'), '# CV\n', 'utf-8');
    writeFileSync(join(root, 'inputs/personalization/profile.yml'), '{}\n', 'utf-8');
    writeFileSync(join(root, 'inputs/config/config.yml'), '{}\n', 'utf-8');
    writeFileSync(join(root, 'content/modes/screen.md'), '# Screen\n', 'utf-8');
    writeFileSync(
      join(root, 'data/applications.md'),
      '| 7 | 2026-07-28 | Acme | Platform Engineer | N/A | Screened | ❌ | [7](artifacts/reports/007-acme.md) | pasted | |',
      'utf-8',
    );
    writeFileSync(
      join(root, 'artifacts/reports/007-acme.md'),
      [
        '---',
        'num: 7',
        'company: Acme',
        'role: Platform Engineer',
        'date: 2026-07-28',
        'source_kind: text',
        'jd_path: inputs/jds/hash.md',
        `jd_hash: ${'a'.repeat(64)}`,
        'status: Screened',
        'state: screened',
        'score: N/A',
        '---',
        '',
        '## TL;DR',
        '',
        'Created.',
      ].join('\n'),
      'utf-8',
    );
    const runLLM = vi.fn(async () => ({
      ok: true,
      stdout: [
        '```json',
        JSON.stringify({
          readable: true,
          company: 'Wrong model company',
          role: 'Wrong model role',
          score: 4.1,
          tldr: '**Strong fit.** Good match.',
          score_breakdown: { cv_match: 4.1 },
        }),
        '```',
      ].join('\n'),
      stderr: '',
      promptText: 'prompt',
    }));
    const runtime = {
      provider: 'codex',
      model: 'test',
      resolvedFrom: 'fallback',
    };
    await runTextScreen(
      { rootPath: root, num: 7 },
      {
        resolveRuntime: () => runtime,
        runLLM,
        trackUsage: vi.fn(),
      },
    );

    expect(runLLM.mock.calls[0][2]).toContain('Saved pasted job description');
    expect(runLLM.mock.calls[0][2]).toContain('Build reliable systems.');
    const { frontmatter } = parseReportFile(
      readFileSync(join(root, 'artifacts/reports/007-acme.md'), 'utf-8'),
    );
    expect(frontmatter.company).toBe('Acme');
    expect(frontmatter.role).toBe('Platform Engineer');
    expect(frontmatter.source_kind).toBe('text');
    expect(frontmatter.jd_path).toBe('inputs/jds/hash.md');
    expect(frontmatter.url).toBeUndefined();
    const trackerAddition = readFileSync(
      join(root, 'batch/tracker-additions/007-acme.tsv'),
      'utf-8',
    );
    expect(trackerAddition).toContain('[7](artifacts/reports/007-acme.md)');
  });
});
