import { expect, test } from '@playwright/test';

// Regression: the kanban board uses native HTML5 drag-and-drop, which does
// not fire from touch gestures. The page-head subtitle must not promise the
// "drag cards between stages" gesture on coarse/hover-less (touch) pointers,
// where it is impossible to perform. Desktop (fine pointer) keeps the drag
// guidance; touch falls back to the device-neutral "move cards" phrasing.
// Read-only: no mutations, no clicks into user-data fields.

test.describe('pipeline drag hint adapts to pointer capability', () => {
  test('desktop (fine pointer) keeps the "drag cards" guidance', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
    });
    const page = await context.newPage();
    await page.goto('/offers?view=kanban');

    const sub = page.locator('.page-head .sub');
    await expect(sub).toContainText('active');
    await expect(sub).toContainText('drag cards between stages');

    await context.close();
  });

  test('touch viewport drops the impossible "drag" wording', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto('/offers?view=kanban');

    const sub = page.locator('.page-head .sub');
    await expect(sub).toContainText('active');
    // "move cards" is fine; "drag cards" must not appear on touch.
    await expect(sub).toContainText('move cards between stages');
    await expect(sub).not.toContainText('drag cards between stages');

    await context.close();
  });
});
