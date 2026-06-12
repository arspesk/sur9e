import { expect, test } from '@playwright/test';

// Regression for the Radix "Missing `Description` or `aria-describedby`"
// a11y warning. The six confirm modals (tailor-cv, research, outreach,
// cover-letter, interview-prep, negotiate) used to render a plain <p> for
// their body copy, so the aria-describedby that Radix always stamps onto
// DialogContent pointed at a non-existent id. A screen reader then
// announced no body, and Radix console.warn'd on every open.
//
// The fix wraps each body paragraph in <DialogDescription>, so the id
// resolves. This test opens each generator confirm modal from the /offers
// row kebab and asserts the dialog's aria-describedby points at a real,
// non-empty element.
//
// Read-only: it opens confirm modals and Cancels them. It never clicks the
// run/primary button, so no job is ever spawned and no user data changes.

// Row-kebab menu item labels (MODE_REGISTRY) → the confirm modal each one
// opens. Evaluate is excluded: it already had a DialogDescription and is out
// of scope for this fix.
const GENERATOR_ACTIONS = [
  'Tailor CV',
  'Company research',
  'Reach out',
  'Interview prep',
  'Cover letter',
  'Negotiate',
] as const;

async function describedByResolves(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const content = document.querySelector('.modal-content[aria-modal]');
    if (!content) return false;
    const ids = (content.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (ids.length === 0) return false;
    // Every referenced id must resolve to a real element with text content.
    return ids.every(id => {
      const el = document.getElementById(id);
      return !!el && (el.textContent ?? '').trim().length > 0;
    });
  });
}

test.describe('confirm modals expose a resolvable aria-describedby', () => {
  for (const action of GENERATOR_ACTIONS) {
    test(`${action} confirm modal has a real DialogDescription`, async ({ page }) => {
      await page.goto('/offers');
      await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

      const firstKebab = page.locator('table.offers tbody tr .col-kebab button').first();
      if ((await firstKebab.count()) === 0) {
        test.skip(true, 'no offer rows in this build');
        return;
      }
      await firstKebab.click();

      const menu = page.locator('[role="menu"][aria-label="Row actions"]');
      await expect(menu).toBeVisible();

      const item = menu.getByRole('menuitem', { name: action, exact: true });
      await expect(item).toBeVisible();
      await item.click();

      const dialog = page.locator('.modal-content[aria-modal]');
      await expect(dialog).toBeVisible();

      expect(await describedByResolves(page)).toBe(true);

      // Close without spawning a job (Cancel, never the primary run button).
      await page.getByRole('button', { name: /^Cancel$/ }).click();
      await expect(dialog).toHaveCount(0);
    });
  }
});
