import { expect, test } from '@playwright/test';

// Regression for the broken skip link: activating "Skip to content" must
// move keyboard focus INTO <main>, not just set location.hash and scroll.
// The fix adds tabIndex={-1} to <main id="main"> so the in-page anchor
// target is programmatically focusable (src/app/layout.tsx).
//
// Read-only: only Tab/Enter keyboard navigation, no mutations, no typing
// into user-data fields.

test('<main id="main"> is programmatically focusable (tabindex=-1)', async ({ page }) => {
  await page.goto('/offers');
  await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

  const tabindex = await page.locator('#main').getAttribute('tabindex');
  expect(tabindex).toBe('-1');
});

test('activating the skip link moves focus into <main>', async ({ page }) => {
  await page.goto('/offers');
  await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

  // First Tab reaches the skip link (it is the first focusable element in body).
  await page.keyboard.press('Tab');
  const skipLink = page.locator('a.skip-link');
  await expect(skipLink).toBeFocused();

  // Activate it — focus should land on <main>, not stay on <body>.
  await page.keyboard.press('Enter');

  const focusedIsMain = await page.evaluate(() => document.activeElement?.id === 'main');
  expect(focusedIsMain).toBe(true);
});
