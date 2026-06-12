import { expect, test } from '@playwright/test';

// Regression for the focus-restoration defect on the /offers row kebab:
// opening a generator confirm modal (Cover letter, Evaluate, …) from a row's
// "Row actions" kebab and then closing it (Escape OR Cancel) dropped focus on
// <body> instead of returning it to the kebab trigger. A keyboard user lost
// their place in the table and had to Tab from the top.
//
// Root cause: the kebab menu unmounts when the modal opens, so by the time the
// modal's Radix FocusScope captures its restore target, activeElement is
// already <body>. Fix: the row kebab threads its trigger element through the
// modal context as `returnFocus`, and DialogContent uses it in
// onCloseAutoFocus to restore focus deterministically.
//
// Read-only: opens confirm modals and closes them via Escape / Cancel. It
// never clicks the run/primary button, so no job is spawned and no user data
// changes.

const GENERATOR_ACTIONS = [
  'Evaluate',
  'Tailor CV',
  'Company research',
  'Reach out',
  'Interview prep',
  'Cover letter',
  'Negotiate',
] as const;

async function openConfirmModal(
  page: import('@playwright/test').Page,
  action: string,
): Promise<{
  kebab: import('@playwright/test').Locator;
  dialog: import('@playwright/test').Locator;
} | null> {
  await page.goto('/offers');
  await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

  const kebab = page.locator('table.offers tbody tr .col-kebab button').first();
  if ((await kebab.count()) === 0) return null;
  await kebab.click();

  const menu = page.locator('[role="menu"][aria-label="Row actions"]');
  await expect(menu).toBeVisible();

  const item = menu.getByRole('menuitem', { name: action, exact: true });
  if ((await item.count()) === 0) return null;
  await item.click();

  const dialog = page.locator('.modal-content[aria-modal]');
  await expect(dialog).toBeVisible();
  return { kebab, dialog };
}

test.describe('row-kebab confirm modals restore focus to the trigger', () => {
  for (const action of GENERATOR_ACTIONS) {
    test(`${action}: Escape restores focus to the kebab`, async ({ page }) => {
      const ctx = await openConfirmModal(page, action);
      if (!ctx) {
        test.skip(true, `no offer rows or "${action}" item in this build`);
        return;
      }
      await page.keyboard.press('Escape');
      await expect(ctx.dialog).toHaveCount(0);
      await expect(ctx.kebab).toBeFocused();
    });

    test(`${action}: Cancel restores focus to the kebab`, async ({ page }) => {
      const ctx = await openConfirmModal(page, action);
      if (!ctx) {
        test.skip(true, `no offer rows or "${action}" item in this build`);
        return;
      }
      await page.getByRole('button', { name: /^Cancel$/ }).click();
      await expect(ctx.dialog).toHaveCount(0);
      await expect(ctx.kebab).toBeFocused();
    });
  }
});
