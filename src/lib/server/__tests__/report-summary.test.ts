import { describe, expect, it } from 'vitest';
import { ReportFrontmatter } from '@/lib/schemas/reports';

describe('ReportFrontmatter', () => {
  it('accepts work_mode and company_logo', () => {
    const parsed = ReportFrontmatter.parse({
      num: 1,
      company: 'Otter',
      role: 'SE',
      date: '2026-05-24',
      status: 'applied',
      state: 'evaluated',
      score: 4.1,
      work_mode: 'On-site',
      company_logo: 'https://logo.clearbit.com/tryotter.com',
    });
    expect(parsed.work_mode).toBe('On-site');
    expect(parsed.company_logo).toBe('https://logo.clearbit.com/tryotter.com');
  });
  it('treats both as optional', () => {
    const parsed = ReportFrontmatter.parse({
      num: 1,
      company: 'X',
      role: 'Y',
      date: '2026-01-01',
      status: 'screened',
      state: 'screened',
      score: 0,
    });
    expect(parsed.work_mode).toBeUndefined();
  });
});
