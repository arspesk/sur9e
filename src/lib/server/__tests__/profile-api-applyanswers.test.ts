// src/lib/server/__tests__/profile-api-applyanswers.test.ts
//
// Regression: GET /api/profile was silently dropping apply_answers from its
// response (only 7 keys returned). This test drives the route handler directly
// and asserts the key is present and is always an array — even when the live
// profile has no answers yet (normalizeApplyAnswers returns [] for undefined).

import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/profile/route';

describe('GET /api/profile includes apply_answers', () => {
  it('returns apply_answers as an array (was undefined before the fix)', async () => {
    const res = await GET();
    const body = await res.json();
    expect(Array.isArray(body.apply_answers)).toBe(true);
  });
});
