import { expect, test } from '@playwright/test';

// Read-only smoke. Per project rule, do NOT mutate user data files
// (inputs/config/config.yml) — assert markup parity + GET wiring only.
test('/settings loads with all section landmarks', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  // Section ids from src/features/settings/sections/*.tsx, in render order.
  // The legacy `theme` section moved to the shell rail's ThemeSwitch;
  // `filtering` and `screening-perf` merged into `screening` (invisible
  // anchor aliases keep their old deep links working — asserted below).
  // Each scan source owns its section: `portals` (ATS) and `jobspy`.
  const sectionIds = ['search', 'portals', 'jobspy', 'screening', 'models', 'system'];
  for (const id of sectionIds) {
    await expect(page.locator(`section#${id}`)).toBeVisible();
  }
  // Document order matches the nav order.
  await expect(page.locator('.settings-content > section.form-section')).toHaveCount(6);
  const domIds = await page
    .locator('.settings-content > section.form-section')
    .evaluateAll(els => els.map(el => el.id));
  expect(domIds).toEqual(sectionIds);
  // Per-source toggles live in their sections; the crawler knobs moved with
  // the JobSpy toggle.
  await expect(page.locator('section#portals #settings-source-ats')).toBeVisible();
  await expect(page.locator('section#jobspy #settings-source-jobspy')).toBeVisible();
  await expect(page.locator('section#jobspy #settings-jobspy-hours')).toBeVisible();
  await expect(page.locator('section#jobspy #settings-jobspy-results')).toBeVisible();
  // Retired anchors survive as zero-size alias spans inside #screening.
  await expect(page.locator('span#filtering.settings-anchor-alias')).toBeAttached();
  await expect(page.locator('span#screening-perf.settings-anchor-alias')).toBeAttached();
  // Theme segmented control lives in the rail now + Save buttons.
  await expect(page.locator('.rail .theme-switch [data-theme-option="light"]')).toBeVisible();
  await expect(page.locator('#checkUpdates')).toBeVisible();
  await expect(page.locator('#rollback')).toBeVisible();
});

test('settings numeric controls remain consistent at all supported widths', async ({ page }) => {
  const viewports = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 667 },
  ];
  await page.addInitScript(() => localStorage.setItem('sur9e.hifi.t', 'dark'));

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/settings#jobspy');

    const numericInputs = page.locator('.settings-content .form-input[type="number"]');
    await expect(numericInputs).toHaveCount(6);
    await expect(page.locator('#settings-jobspy-hours')).toBeVisible();
    await expect(page.locator('#settings-jobspy-results')).toBeVisible();
    const jobspySection = page.locator('section#jobspy');
    await expect
      .poll(() => jobspySection.evaluate(element => getComputedStyle(element).opacity))
      .toBe('1');
    await jobspySection.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect
      .poll(async () => {
        const box = await jobspySection.boundingBox();
        return box != null && box.y >= 55 && box.y < viewport.height;
      })
      .toBe(true);

    if (process.env.VISUAL_QA_DIR) {
      await page.screenshot({
        path: `${process.env.VISUAL_QA_DIR}/settings-number-steppers-${viewport.name}.png`,
      });
    }
  }
});
