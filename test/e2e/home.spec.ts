// Home control center at / and the full-screen chat at /chat.
//
// These assert structure, not data: the tracker is user data that drifts, so
// the specs check that each surface mounts with its widgets rather than that
// any particular offer or count is present.

import { expect, test } from '@playwright/test';

test('/ renders the control center instead of redirecting to /offers', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.home-hero__greeting')).toBeVisible();
  // Hero composer is the real chat composer, not a stub.
  await expect(page.locator('.home-hero__composer .chat-composer')).toBeVisible();
  await expect(page.locator('.agenda-grid .agenda-card')).toHaveCount(4);
  await expect(page.locator('#followups')).toBeVisible();
  await expect(page.locator('#pending')).toBeVisible();
});

test('agenda cards each carry a ghosted content icon', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.agenda-card__wm')).toHaveCount(4);
  await expect(page.locator('.agenda-card').first().locator('.agenda-card__count')).toBeVisible();
});

test('rail exposes Home and Chat, and Chat opens the full-screen surface', async ({ page }) => {
  await page.goto('/');

  // Home is the active workspace item on /.
  await expect(page.locator('.rail-item.active .rail-label')).toHaveText('Home');

  await page.locator('.rail-item', { hasText: 'Chat' }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator('.chat-threads')).toBeVisible();
});

test('/chat shows the thread sidebar and composer, and hides the bubble', async ({ page }) => {
  await page.goto('/chat');

  await expect(page.locator('.chat-threads__new')).toBeVisible();
  await expect(page.locator('.chat-page__composer .chat-composer')).toBeVisible();
  // The bubble would be a second, competing surface for the same conversation.
  await expect(page.locator('.chat-bubble')).toHaveCount(0);
});

test('bubble expand button opens the full-screen chat', async ({ page }) => {
  await page.goto('/offers');

  await page.locator('.chat-bubble').click();
  await expect(page.locator('.chat-card')).toBeVisible();

  await page.locator('.chat-header__expand').click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator('.chat-threads')).toBeVisible();
});
