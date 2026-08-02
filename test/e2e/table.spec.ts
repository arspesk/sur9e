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

test('offers filters hide the floating chat launcher in both views', async ({ page }) => {
  const viewports = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 667 },
  ];
  const views = [
    { name: 'table', url: '/offers' },
    { name: 'kanban', url: '/offers?view=kanban' },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    for (const view of views) {
      await page.goto(view.url);

      const chatLauncher = page.getByRole('button', { name: 'Open chat' });
      const filterButton = page.getByRole('button', { name: 'Filter offers' });
      await expect(chatLauncher).toBeVisible();

      await expect
        .poll(async () => {
          if ((await filterButton.getAttribute('aria-expanded')) !== 'true') {
            await filterButton.click();
          }
          return filterButton.getAttribute('aria-expanded');
        })
        .toBe('true');
      const filterPanel = page.getByRole('dialog', { name: 'Filters' });
      await expect(filterPanel).toBeVisible();
      await expect(chatLauncher).toBeHidden();
      await expect
        .poll(async () => {
          const box = await filterPanel.boundingBox();
          if (!box) return false;
          return viewport.width <= 640
            ? Math.abs(box.y + box.height - viewport.height) <= 1
            : Math.abs(box.x + box.width - viewport.width) <= 1;
        })
        .toBe(true);

      if (process.env.VISUAL_QA_DIR) {
        await page.screenshot({
          path: `${process.env.VISUAL_QA_DIR}/offers-filters-${view.name}-${viewport.name}.png`,
        });
      }

      await page.getByRole('button', { name: 'Close filters' }).click();
      await expect(page.getByRole('dialog', { name: 'Filters' })).toBeHidden();
      await expect(chatLauncher).toBeVisible();
    }
  }
});
