import { expect, test } from '@playwright/test';

// Regression for two /offers table-row fixes:
//  1. Escape dismisses the per-row ⋯ kebab menu (was swallowed by the
//     col-kebab <td onKeyDown=stopPropagation> before the portaled menu's
//     document listener ran — fixed by capturing the keydown on document).
//  2. The Date column shows the full ISO date at the default column width
//     instead of truncating to "2026-…" (min-width bump on .col-date).
//
// Read-only: opens a menu and presses Escape, then measures layout. No
// mutations, no typing into user-data fields.

test('row kebab menu closes on Escape and returns focus to the trigger', async ({ page }) => {
  await page.goto('/offers');
  await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

  const firstKebab = page.locator('table.offers tbody tr .col-kebab button').first();
  await expect(firstKebab).toBeVisible();
  await firstKebab.click();

  const menu = page.locator('aside[role="menu"]');
  await expect(menu).toBeVisible();

  await page.keyboard.press('Escape');

  // Menu dismissed, and focus is back on the kebab trigger (keyboard cancel path).
  await expect(menu).toHaveCount(0);
  await expect(firstKebab).toBeFocused();
});

test('Date column shows the full ISO date without truncation at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/offers');
  await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

  const dateCell = page.locator('table.offers tbody tr .col-date').first();
  await expect(dateCell).toBeVisible();

  // The full text must fit: no ellipsis clipping at the default column width.
  const fits = await dateCell.evaluate(el => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);

  // And the rendered text must be a complete ISO date, not "2026-…".
  const text = (await dateCell.innerText()).trim();
  expect(text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

// Regression for the WAI-ARIA menu keyboard pattern on the row kebab:
// ArrowDown/ArrowUp move focus across role=menuitem entries (wrapping),
// Home/End jump to the edges. Focus starts on the menu container, so the
// first ArrowDown arms the first item. Read-only — never activates an item.
test('row kebab menu supports Arrow/Home/End navigation across menu items', async ({ page }) => {
  await page.goto('/offers');
  await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

  const firstKebab = page.locator('table.offers tbody tr .col-kebab button').first();
  await firstKebab.click();

  const menu = page.locator('aside[role="menu"]');
  await expect(menu).toBeVisible();
  const items = menu.locator('button[role="menuitem"]:not([disabled])');
  const count = await items.count();
  expect(count).toBeGreaterThan(1);

  // ArrowDown from the container arms the first item…
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();

  // …ArrowDown again moves to the second…
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();

  // …ArrowUp moves back…
  await page.keyboard.press('ArrowUp');
  await expect(items.first()).toBeFocused();

  // …ArrowUp from the first wraps to the last, End/Home jump to the edges.
  await page.keyboard.press('ArrowUp');
  await expect(items.nth(count - 1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.nth(count - 1)).toBeFocused();

  // Escape still dismisses and restores the trigger.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(firstKebab).toBeFocused();
});

// Regression for the flip-up overlap bug: at short viewports the menu used
// to clamp to the viewport top and cover its own trigger, so the re-click
// meant to DISMISS the menu fired whatever menu item sat over the kebab
// (geometry-dependent — could be the danger Delete or a generator launch).
// The fix caps the menu's height to the available gap instead of letting it
// overlap. Read-only: stubs all server-action POSTs and asserts none fire.
test('open kebab menu never overlaps its trigger; re-click toggles closed without firing an item', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });

  // Count any server-action POST a stray item-activation would fire.
  let actionPosts = 0;
  await page.route('**/*', async route => {
    const req = route.request();
    if (req.method() === 'POST' && req.headers()['next-action']) {
      actionPosts += 1;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/x-component' },
        body: '0:{"ok":true}\n',
      });
    }
    return route.continue();
  });

  await page.goto('/offers');
  await expect(page.getByRole('heading', { name: /Offers/i })).toBeVisible();

  const kebabs = page.locator('table.offers tbody tr .col-kebab button');
  const count = Math.min(await kebabs.count(), 12);
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const kebab = kebabs.nth(i);
    if (!(await kebab.isVisible())) continue;
    await kebab.click();
    const menu = page.locator('aside[role="menu"][aria-label="Row actions"]');
    await expect(menu).toBeVisible();

    // The menu's box must never intersect the trigger's box.
    const triggerBox = await kebab.boundingBox();
    const menuBox = await menu.boundingBox();
    if (triggerBox && menuBox) {
      const intersects =
        menuBox.x < triggerBox.x + triggerBox.width &&
        menuBox.x + menuBox.width > triggerBox.x &&
        menuBox.y < triggerBox.y + triggerBox.height &&
        menuBox.y + menuBox.height > triggerBox.y;
      expect(intersects, `kebab #${i}: menu must not cover its trigger`).toBe(false);
    }

    // Re-click the trigger: toggles closed, activates nothing.
    const before = actionPosts;
    await kebab.click();
    await expect(menu).toHaveCount(0);
    expect(actionPosts, `kebab #${i}: dismiss-click must not fire a menu item`).toBe(before);
  }
});
