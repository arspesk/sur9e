import { expect, test } from '@playwright/test';

test('/analytics renders the surface', async ({ page }) => {
  await page.goto('/analytics');

  await expect(page.locator('.analytics-content')).toBeVisible();
  // Wait for queries to resolve and skeleton to drop.
  await expect(page.locator('.analytics-content')).toHaveAttribute('data-loading', 'false', {
    timeout: 10_000,
  });
});

test('/analytics shows all four KPI cards and major sections', async ({ page }) => {
  await page.goto('/analytics');

  await expect(page.locator('.analytics-content')).toHaveAttribute('data-loading', 'false', {
    timeout: 10_000,
  });

  // Four stat tiles.
  await expect(page.locator('.stat-card')).toHaveCount(4);

  // Funnel section + its pipeline stages. Screened is pre-pipeline and was
  // moved out of the funnel into the side-note, leaving 5 stages
  // (Evaluated → Applied → Responded → Interview → Offer); see
  // src/features/analytics/funnel-section.tsx STAGES.
  await expect(page.locator('.funnel-card')).toBeVisible();
  await expect(page.locator('.funnel-row')).toHaveCount(5);

  // Both spend cards present.
  await expect(page.locator('.spend-card')).toHaveCount(2);

  // Archetype card present.
  await expect(page.locator('.archetype-card')).toBeVisible();
});

test('/analytics date-range picker opens, selecting a preset updates label', async ({ page }) => {
  await page.goto('/analytics');
  await expect(page.locator('.analytics-content')).toHaveAttribute('data-loading', 'false', {
    timeout: 10_000,
  });

  const trigger = page.locator('#rangeTrigger');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const popover = page.locator('#rangePopover');
  await expect(popover).toBeVisible();

  await popover.locator('[data-preset="7d"]').click();

  await expect(page.locator('#rangeTriggerLabel')).toHaveText('Last 7 days');
});
