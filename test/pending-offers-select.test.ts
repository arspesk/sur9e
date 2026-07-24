import { describe, expect, it } from 'vitest';
import { selectPendingOffers } from '@/features/home/pending-offers-select';

const row = (num: number, status: string, score: string) => ({
  num,
  company: `Co${num}`,
  role: 'SE',
  score,
  status,
  reportPath: null,
});

describe('selectPendingOffers', () => {
  it('keeps only screened/evaluated, sorted by score desc', () => {
    const out = selectPendingOffers([
      row(1, 'Applied', '4.5/5'),
      row(2, 'Screened', '3.9/5'),
      row(3, 'Evaluated', '4.2/5'),
      row(4, 'Rejected', '5.0/5'),
    ]);
    expect(out.map(o => o.num)).toEqual([3, 2]);
    expect(out[0].status).toBe('evaluated');
  });
  it('sinks N/A and unparseable scores to the end', () => {
    const out = selectPendingOffers([
      row(1, 'Screened', 'N/A'),
      row(2, 'Screened', '3.1/5'),
      row(3, 'Evaluated', '-'),
    ]);
    expect(out.map(o => o.num)).toEqual([2, 1, 3]);
  });
  it('caps at the limit (default 6)', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      row(i + 1, 'Evaluated', `${(4 - i * 0.1).toFixed(1)}/5`),
    );
    expect(selectPendingOffers(many)).toHaveLength(6);
    expect(selectPendingOffers(many, 3)).toHaveLength(3);
  });
});
