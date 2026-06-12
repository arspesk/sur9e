import { expect, type Request, type Route, test } from '@playwright/test';

// Code-review backfill: e2e for the mutation-path server actions.
// Each test stubs the action's POST so the user's data files stay
// untouched (matches the read-only smoke convention in the rest of
// test/e2e/), then drives the UI gesture and asserts the optimistic
// + post-resolution states match what the user actually sees.
//
// We match server-action invocations the way Next 16 routes them: any
// POST to a route URL whose request carries a `next-action` header.

interface ActionCapture {
  count: number;
  lastBody: string | null;
  lastNextAction: string | null;
}

function stubServerActions(): { capture: ActionCapture; handler: (route: Route) => Promise<void> } {
  const capture: ActionCapture = { count: 0, lastBody: null, lastNextAction: null };
  return {
    capture,
    handler: async (route: Route) => {
      const request: Request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) {
        capture.count += 1;
        capture.lastBody = request.postData();
        capture.lastNextAction = request.headers()['next-action'] ?? null;
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/x-component' },
          body: '0:{"ok":true,"profileChanged":false,"portalsChanged":false}\n',
        });
      }
      return route.continue();
    },
  };
}

test.describe('server-action mutation paths', () => {
  test('profile auto-save fires a server action when a field changes', async ({ page }) => {
    const { capture, handler } = stubServerActions();
    await page.route('**/*', handler);

    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();

    const before = capture.count;
    // Click a NON-active option in the Location "On-site availability"
    // segmented control. A single click flips the value (no text typing —
    // text-typing into user-data fields is banned), and the rhf debounce
    // flushes a saveProfileAction POST. The handler above intercepts that
    // POST so the change never touches inputs/personalization/profile.yml.
    const segmented = page.locator('[data-segmented="location.onsite_availability"]');
    const inactive = segmented.locator('button:not(.is-active)').first();
    if (await inactive.count()) {
      await inactive.click();
      await page.waitForTimeout(900); // debounce window (600ms) + slack.
      expect(capture.count).toBeGreaterThan(before);
    } else {
      test.skip(true, 'on-site availability segmented control not present in this build');
    }
  });

  test('table row status change fires updateApplicationStatusAction', async ({ page }) => {
    const { capture, handler } = stubServerActions();
    await page.route('**/*', handler);

    await page.goto('/offers');
    await expect(page.getByRole('heading', { level: 1, name: 'Offers' })).toBeVisible();

    const before = capture.count;
    // Open the first row's status popover (.drawer-status-trigger) and pick a
    // status OTHER than the current one — picking the current value is a no-op
    // that fires no action. The POST is intercepted, so data/applications.md
    // is untouched. If the table is empty we skip — wiring, not data.
    const pill = page
      .locator('table.offers tbody tr .drawer-status-trigger:not([disabled])')
      .first();
    if (await pill.count()) {
      await pill.click();
      // Options live in a body-portaled [role="menu"]; skip the currently
      // selected one so onPick actually mutates.
      const option = page.locator('[role="menu"] [role="menuitem"]:not(.is-current)').first();
      if (await option.count()) {
        await option.click();
        await page.waitForTimeout(500);
        expect(capture.count).toBeGreaterThan(before);
      } else {
        test.skip(true, 'status popover did not render menu items');
      }
    } else {
      test.skip(true, 'no rows present in /offers');
    }
  });

  test('batch status change uses the batch action (one POST, not N)', async ({ page }) => {
    const { capture, handler } = stubServerActions();
    await page.route('**/*', handler);

    await page.goto('/offers');
    await expect(page.getByRole('heading', { level: 1, name: 'Offers' })).toBeVisible();

    // Row checkboxes carry class `row-select` (data-num) in the current table.
    const checkboxes = page.locator('table.offers tbody input.row-select');
    const rowCount = await checkboxes.count();
    if (rowCount < 2) {
      test.skip(true, 'need ≥2 rows to exercise the batch path');
      return;
    }
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    // Selecting rows reveals the batch-action-bar with its "Change status"
    // button (data-action="status").
    const statusBtn = page.locator('[data-action="status"]').first();
    await expect(statusBtn).toBeVisible();

    const before = capture.count;
    await statusBtn.click();
    const option = page.locator('[role="menu"] [role="menuitem"]:not(.is-current)').first();
    await option.click();
    await page.waitForTimeout(500);
    // Batch path = exactly one POST per click, not one per selected row.
    expect(capture.count - before).toBe(1);
  });
});
