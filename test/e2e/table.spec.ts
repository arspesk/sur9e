import { expect, test } from '@playwright/test';

// /table now 307-redirects to /offers; the offers table + drawer live there.
// Clicking a row's company cell opens the offer detail drawer (#cdDrawer,
// which gains the `.on` class while open).
test('/offers loads and clicking a row opens the offer drawer', async ({ page }) => {
  await page.goto('/offers');
  await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

  const firstRow = page.locator('table.offers tbody tr').first();
  await expect(firstRow).toBeVisible();
  await firstRow.locator('.col-co').click();

  // The detail drawer is #cdDrawer.cd-drawer; it gets `.on` once opened.
  await expect(page.locator('.cd-drawer.on')).toBeVisible();
});
