// src/lib/server/__tests__/pipeline-schema.test.ts
//
// Parse-boundary tests for the typed entrypoint that wraps pipeline.mjs.
// All fixtures live in os.tmpdir() — never touches the real data/pipeline.md.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PipelineResult } from '../../schemas/pipeline';
// Resolves to ../pipeline.ts (the typed wrapper). See usage-schema.test.ts
// for why vitest.config.ts pins resolve.extensions to prefer .ts over .mjs.
import { clearPending, loadPipeline } from '../pipeline';

function makeTmpRoot(md?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-schema-test-'));
  mkdirSync(join(root, 'data'));
  if (md !== undefined) writeFileSync(join(root, 'data/pipeline.md'), md);
  return root;
}

describe('pipeline.ts — schema boundary', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('loadPipeline parses pending entries through PipelineResult', () => {
    const md = [
      '# Pipeline',
      '',
      '- [ ] https://example.com/jobs/1 | Acme | Engineer',
      '- [ ] https://example.com/jobs/2 | Globex | Forward Deployed Engineer',
      '- [ ] https://example.com/jobs/3',
      '- [x] https://example.com/jobs/4 | Done | Should be skipped',
      'random non-list line',
    ].join('\n');
    root = makeTmpRoot(md);

    const result = loadPipeline(root);
    expect(() => PipelineResult.parse(result)).not.toThrow();
    expect(result.pending).toHaveLength(3);
    expect(result.pending[0]).toEqual({
      url: 'https://example.com/jobs/1',
      company: 'Acme',
      role: 'Engineer',
    });
    expect(result.pending[1].role).toBe('Forward Deployed Engineer');
    // No company/role on entry 3 — defaults to empty strings.
    expect(result.pending[2]).toEqual({
      url: 'https://example.com/jobs/3',
      company: '',
      role: '',
    });
  });

  it('loadPipeline returns an empty list when data/pipeline.md is missing', () => {
    root = makeTmpRoot(); // no markdown file
    const result = loadPipeline(root);
    expect(() => PipelineResult.parse(result)).not.toThrow();
    expect(result.pending).toEqual([]);
  });

  it('clearPending removes only the pending rows, keeps processed + other lines', () => {
    const md = [
      '# Pipeline',
      '',
      '## Pending',
      '- [ ] https://example.com/jobs/1 | Acme | Engineer',
      '- [ ] https://example.com/jobs/2',
      '- [x] https://example.com/jobs/4 | Done | Kept',
      'random non-list line',
    ].join('\n');
    root = makeTmpRoot(md);

    const removed = clearPending(root);
    expect(removed).toBe(2);

    const after = loadPipeline(root);
    expect(after.pending).toEqual([]);
    // Processed history + headings + prose survive untouched.
    const raw = readFileSync(join(root, 'data/pipeline.md'), 'utf-8');
    expect(raw).toContain('- [x] https://example.com/jobs/4 | Done | Kept');
    expect(raw).toContain('## Pending');
    expect(raw).toContain('random non-list line');
  });

  it('clearPending is a no-op (0) on a missing file or an empty queue', () => {
    root = makeTmpRoot(); // no file
    expect(clearPending(root)).toBe(0);
    writeFileSync(join(root, 'data/pipeline.md'), '# Pipeline\n- [x] https://x.com/1 | A | B\n');
    expect(clearPending(root)).toBe(0);
  });
});
