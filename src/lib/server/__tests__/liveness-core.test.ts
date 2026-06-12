// src/lib/server/__tests__/liveness-core.test.ts
//
// Regression tests for the liveness classifier — migrated from the inline
// dynamic-import block that lived in test-all.mjs Section 3.
// Covers the two key edge cases: "Apply" text in nav/footer must not revive
// an expired page; visible apply controls on a real listing page keep it active.

import { describe, expect, it } from 'vitest';
import { classifyLiveness } from '../liveness-core';

describe('classifyLiveness', () => {
  it('expired pages are not revived by nav/footer "Apply" text', () => {
    const result = classifyLiveness({
      finalUrl: 'https://example.com/jobs/closed-role',
      bodyText: 'Company Careers\nApply\nThe job you are looking for is no longer open.',
      applyControls: [],
    });
    expect(result.result).toBe('expired');
  });

  it('visible apply controls keep real job pages active', () => {
    const result = classifyLiveness({
      finalUrl: 'https://example.workday.com/job/123',
      bodyText: [
        '663 JOBS FOUND',
        'Senior AI Engineer',
        'Join our applied AI team to ship production systems, partner with customers, and own delivery across evaluation, deployment, and reliability.',
      ].join('\n'),
      applyControls: ['Apply for this Job'],
    });
    expect(result.result).toBe('active');
  });
});
