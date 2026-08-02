import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf-8');

const STATUS_SURFACES = [
  'src/components/status-popover-host.tsx',
  'src/features/home/pending-offers-section.tsx',
  'src/features/pipeline/board.tsx',
  'src/features/table/offers-table.tsx',
  'src/features/table/batch-action-bar.tsx',
];

describe('evaluated status follow-up contract', () => {
  it.each(STATUS_SURFACES)('%s opens evaluation as an optional post-save follow-up', path => {
    const source = read(path);
    expect(source).toContain('statusFollowup: true');
    expect(source).not.toContain('patchToEvaluated');
    expect(source).not.toContain('onStatusOnly');
  });

  it('removes status persistence and the redundant status-only action from EvaluateModal', () => {
    const source = read('src/components/modals/evaluate-modal.tsx');
    expect(source).not.toContain('Set status only');
    expect(source).not.toContain('updateApplicationStatusAction');
    expect(source).not.toContain('patchToEvaluated');
    expect(source).not.toContain('onStatusOnly');
  });
});
