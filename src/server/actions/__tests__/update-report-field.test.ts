import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const updateField = vi.fn();
const resolvePath = vi.fn(() => '/abs/016-otter.md');
vi.mock('@/lib/server/reports', () => ({
  updateReportFrontmatterField: (...a: Parameters<typeof updateField>) => updateField(...a),
  reportPathForNum: (...a: Parameters<typeof resolvePath>) => resolvePath(...a),
  // Other exports from reports.ts that applications.ts may import
  loadReport: vi.fn(),
  extractAppendedSections: vi.fn(),
  parseFrontmatter: vi.fn(),
  serializeFrontmatter: vi.fn(),
  saveReport: vi.fn(),
  isFrontmatterFormat: vi.fn(),
  clearRunningModePlaceholder: vi.fn(),
}));

import { updateReportFieldAction } from '../applications';

beforeEach(() => {
  updateField.mockClear();
  resolvePath.mockClear();
});

describe('updateReportFieldAction', () => {
  it('resolves the report path by num and writes the field', async () => {
    await updateReportFieldAction({ num: 16, field: 'work_mode', value: 'On-site' });
    expect(resolvePath).toHaveBeenCalledWith(expect.anything(), 16);
    expect(updateField).toHaveBeenCalledWith('/abs/016-otter.md', 'work_mode', 'On-site');
  });

  it('rejects an unknown / read-only field before touching disk', async () => {
    await expect(
      updateReportFieldAction({ num: 16, field: 'company', value: 'X' }),
    ).rejects.toThrow();
    expect(updateField).not.toHaveBeenCalled();
  });
});
