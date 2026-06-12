import { expect, test } from '@playwright/test';
import { REPORT_FIXTURE, skipIfNoReport } from './_fixtures';

// Regression: report routes (/report/[filename]) must anchor to the Offers
// nav item in both shells, since reports are reached from the offers list.
// Previously the rail used a strict `pathname === '/offers'` check and the
// mobile bottom-bar's Offers tab `activeOn` set omitted '/report', so the
// report route highlighted nothing in either shell. Read-only navigation
// asserting the active class + aria-current — no mutations.

test('/report/[filename] highlights the Offers rail item (desktop)', async ({ page }) => {
  skipIfNoReport();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/report/${REPORT_FIXTURE}`);
  await expect(page.locator('[data-testid="report-body"]')).toBeVisible({ timeout: 10_000 });

  const activeRailItems = page.locator('aside.rail a.rail-item.active');
  await expect(activeRailItems).toHaveCount(1);
  const active = activeRailItems.first();
  await expect(active).toHaveAttribute('href', '/offers');
  await expect(active).toHaveAttribute('aria-current', 'page');
});

test('/report/[filename] highlights the Offers bottom-bar tab (mobile)', async ({ page }) => {
  skipIfNoReport();
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`/report/${REPORT_FIXTURE}`);
  await expect(page.locator('[data-testid="report-body"]')).toBeVisible({ timeout: 10_000 });

  const activeTabs = page.locator('nav.bottom-bar a.bottom-bar-tab.active');
  await expect(activeTabs).toHaveCount(1);
  const active = activeTabs.first();
  await expect(active).toHaveAttribute('data-tab', 'offers');
  await expect(active).toHaveAttribute('aria-current', 'page');
});
