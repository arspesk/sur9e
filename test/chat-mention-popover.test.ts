import { describe, expect, it } from 'vitest';
import { filterMentionItems } from '@/features/chat/mention-popover';
import type { ApplicationRow } from '@/features/table/table-types';

const row = (num: number, company: string, role: string) =>
  ({ num, company, role, status: 'applied' }) as ApplicationRow;

const rows = [
  row(3, 'Attio', 'Staff Engineer'),
  row(48, 'Linear', 'Frontend'),
  row(12, 'Attio', 'Platform'),
];

describe('filterMentionItems', () => {
  it('empty filter → all offers, most recent (highest num) first', () => {
    expect(filterMentionItems(rows, '').map(i => i.num)).toEqual([48, 12, 3]);
  });
  it('matches company, role, and #num case-insensitively', () => {
    expect(filterMentionItems(rows, 'att').map(i => i.num)).toEqual([12, 3]);
    expect(filterMentionItems(rows, 'front').map(i => i.num)).toEqual([48]);
    expect(filterMentionItems(rows, '#48').map(i => i.num)).toEqual([48]);
  });
});
