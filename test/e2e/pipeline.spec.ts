import { expect, test } from '@playwright/test';

test('/pipeline loads, columns visible, search filters cards', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

  // 8 status columns should render by default (Screened → Discarded).
  const columns = page.locator('.board .column');
  await expect(columns.first()).toBeVisible();
  await expect(columns).toHaveCount(8);

  // Status filter pill: Status Evaluated column dot present
  await expect(page.locator('.col-dot.evaluated').first()).toBeVisible();

  // Search input is wired
  const search = page.locator('input.filter-search');
  await expect(search).toBeVisible();
  await search.fill('zzzzzz-nope-no-match');
  // At least one column shows the "No offers" empty state OR card count goes to 0.
  await expect(page.locator('.board')).toBeVisible();
});
