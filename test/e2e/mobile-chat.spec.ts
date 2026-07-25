// Phones have no full-screen chat: the bubble card is already an inset:0
// takeover at ≤640px, so /chat bounces home and every entry point opens the
// bubble in place instead of routing.

import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 } });

test('/chat on a phone bounces home and opens the bubble', async ({ page }) => {
  await page.goto('/chat');

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.chat-card')).toBeVisible();
  await expect(page.locator('.chat-page')).toHaveCount(0);
});

test('the bubble hides its expand control on a phone', async ({ page }) => {
  await page.goto('/');
  await page.locator('.chat-bubble').click();

  await expect(page.locator('.chat-card')).toBeVisible();
  await expect(page.locator('.chat-header__expand')).toBeHidden();
  // The close button keeps its place at the right edge — hiding the expand
  // button must not let the pair rule pin it next to the title.
  await expect(page.locator('.chat-header__close:not(.chat-header__expand)')).toBeVisible();
});

test('sending from the Home hero opens that conversation in the bubble', async ({ page }) => {
  await page.goto('/');

  const composer = page.locator('.home-hero__composer textarea');
  await composer.click();
  await composer.fill('hello from the home hero');
  await composer.press('Enter');

  // Stays on Home — no /chat round trip — with the bubble showing the message
  // that was just sent.
  await expect(page.locator('.chat-card')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.chat-card')).toContainText('hello from the home hero', {
    timeout: 15_000,
  });
});
