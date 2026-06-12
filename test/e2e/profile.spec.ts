import { expect, test } from '@playwright/test';

// Read-only smoke. Per project rule, do NOT mutate user data files
// (inputs/personalization/profile.yml, inputs/personalization/{cv,narrative,
// article-digest}.md) — intercept every /api/profile* PATCH/PUT and
// short-circuit them so even if a paint triggers a debounce the file
// system stays untouched.

test('/profile loads with all section landmarks and TipTap editor mounts', async ({ page }) => {
  // Block writes so test execution can't mutate user data.
  await page.route('**/api/profile', async (route, request) => {
    if (request.method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, profileChanged: false }),
      });
    }
    return route.continue();
  });
  await page.route('**/api/profile/md/**', async (route, request) => {
    if (request.method() === 'PUT') {
      return route.fulfill({ status: 200, body: '' });
    }
    return route.continue();
  });

  await page.goto('/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();

  // Eight sections from public/profile.html.
  for (const id of [
    'identity',
    'targets',
    'pitch',
    'comp',
    'location',
    'cv',
    'narrative',
    'digest',
  ]) {
    await expect(page.locator(`section#${id}`)).toBeVisible();
  }

  // Required-field markers (asterisks) present on Identity + Targets +
  // Comp + Location labels — these mirror the legacy DOM markers.
  await expect(page.locator('[data-key="candidate.full_name"]')).toBeVisible();
  await expect(page.locator('[data-key="candidate.email"]')).toBeVisible();
  await expect(page.locator('[data-rowlist="target_roles.archetypes"]')).toBeVisible();
  await expect(page.locator('[data-chiplist="search.terms"]')).toBeVisible();
  await expect(page.locator('[data-chiplist="search.locations"]')).toBeVisible();

  // TipTap editor mount on each markdown section — host `[data-md-host]`
  // gets a child `.be-prose` once @tiptap/react finishes initializing.
  for (const name of ['cv', 'narrative', 'article-digest']) {
    const host = page.locator(`[data-md-host="${name}"]`);
    await expect(host).toBeVisible();
    await expect(host.locator('.be-prose')).toBeVisible();
  }
});
