import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 667 },
] as const;

for (const viewport of viewports) {
  test(`kanban score and vertical menu stay aligned at ${viewport.name}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.name !== 'desktop',
      isMobile: viewport.name === 'mobile',
    });
    try {
      const page = await context.newPage();
      await page.goto('/offers?view=kanban');

      const card = page.locator('.board .card').first();
      test.skip((await card.count()) === 0, 'No local offer fixture is available for visual QA');
      await expect(card).toBeVisible();

      const company = card.locator('.card-company');
      const score = card.locator('.score-num');
      const menu = card.locator('.board-card-kebab');
      const icon = menu.locator('svg.menu-dots-icon.lucide-ellipsis-vertical');
      await expect(company).toBeVisible();
      await expect(score).toBeVisible();
      await expect(menu).toBeVisible();
      await expect(icon).toBeVisible();

      const [cardBox, companyBox, scoreBox, menuBox, iconBox] = await Promise.all([
        card.boundingBox(),
        company.boundingBox(),
        score.boundingBox(),
        menu.boundingBox(),
        icon.boundingBox(),
      ]);
      expect(cardBox).not.toBeNull();
      expect(companyBox).not.toBeNull();
      expect(scoreBox).not.toBeNull();
      expect(menuBox).not.toBeNull();
      expect(iconBox).not.toBeNull();
      if (!cardBox || !companyBox || !scoreBox || !menuBox || !iconBox) return;

      expect(scoreBox.x).toBeGreaterThan(companyBox.x);
      expect(companyBox.x + companyBox.width).toBeLessThanOrEqual(scoreBox.x + 1);
      expect(companyBox.y + companyBox.height).toBeGreaterThan(scoreBox.y);
      expect(scoreBox.y + scoreBox.height).toBeGreaterThan(companyBox.y);
      expect(scoreBox.x + scoreBox.width).toBeLessThanOrEqual(menuBox.x + 1);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      expect(iconBox.width).toBeCloseTo(16, 0);
      expect(iconBox.height).toBeCloseTo(16, 0);

      await page.screenshot({
        path: testInfo.outputPath(
          `pipeline-card-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });
}
