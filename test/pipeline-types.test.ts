import { describe, expect, it } from 'vitest';
import { COLUMNS } from '@/features/pipeline/board-types';

describe('pipeline columns', () => {
  it('has 8 columns in the expected order', () => {
    expect(COLUMNS.map(c => c.key)).toEqual([
      'screened',
      'evaluated',
      'applied',
      'responded',
      'interview',
      'offer',
      'rejected',
      'discarded',
    ]);
  });
});
