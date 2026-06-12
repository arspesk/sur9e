import { expect, type Route, test } from '@playwright/test';

// Regression for the keyboard-trap bug: the in-progress job-progress card is a
// non-modal `role="status"` live region and must NEVER trap global Tab focus
// (WCAG 2.1.2 No Keyboard Trap). Previously useFocusTrap was applied to the
// front card while a job ran, locking Tab to the card's 3 buttons app-wide.
//
// Read-only: we stub ONLY the GET reads that mount the card —
//   /api/jobs/active  -> one running job
//   /api/jobs/<id>    -> a running snapshot
// No real job is launched and no user data is touched.

const JOB_ID = 'e2e-trap-fixture-9999';

async function stubRunningJob(route: Route): Promise<void> {
  const url = route.request().url();
  if (url.includes('/api/jobs/active')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        evaluate: [{ id: JOB_ID, num: 9999, startedAt: new Date().toISOString() }],
      }),
    });
  }
  if (url.includes(`/api/jobs/${JOB_ID}`)) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'running',
        output: '',
        startedAt: new Date().toISOString(),
        params: { num: 9999 },
      }),
    });
  }
  return route.continue();
}

test.describe('loading-modal job-progress card a11y', () => {
  test('in-progress card does not trap global Tab focus', async ({ page }) => {
    await page.route('**/api/jobs/**', stubRunningJob);

    await page.goto('/analytics');

    // Wait for the in-progress card to mount.
    const card = page.locator('.loading-modal-card');
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Tab a generous number of times; at least one focus stop must land OUTSIDE
    // the card. A focus trap would keep every stop inside .loading-modal-card.
    let reachedOutsideCard = false;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const insideCard = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? Boolean(el.closest('.loading-modal-card')) : false;
      });
      if (!insideCard) {
        reachedOutsideCard = true;
        break;
      }
    }

    expect(reachedOutsideCard).toBe(true);
  });
});
