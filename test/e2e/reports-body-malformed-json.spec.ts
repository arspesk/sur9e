import { expect, test } from '@playwright/test';

// Regression: PATCH /api/reports/[filename]/body must reject a malformed JSON
// request body with a 400 (Bad Request), not crash with a 500. The route now
// guards `req.json()` with `.catch(() => null)`, matching the defensive pattern
// used by api/settings, api/profile, api/applications/[num], and api/jobs/*.
//
// Read-only / no-write negative path: the throw (and now the 400) happens
// before any file resolution or saveReport, so no real report filename is
// needed and nothing on disk is touched.
test.describe('PATCH /api/reports/[filename]/body — malformed JSON', () => {
  const url = '/api/reports/zzz.md/body';

  test('non-JSON body returns 400, not 500', async ({ request }) => {
    const res = await request.patch(url, {
      headers: { 'Content-Type': 'application/json' },
      data: 'not json at all',
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'body must be string' });
  });

  test('truncated JSON body returns 400, not 500', async ({ request }) => {
    const res = await request.patch(url, {
      headers: { 'Content-Type': 'application/json' },
      data: '{bad',
    });
    expect(res.status()).toBe(400);
  });

  test('valid JSON without a string body still returns 400', async ({ request }) => {
    const res = await request.patch(url, {
      headers: { 'Content-Type': 'application/json' },
      data: '{}',
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'body must be string' });
  });
});
