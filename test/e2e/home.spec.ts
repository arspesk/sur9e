// Home control center at / and the full-screen chat at /chat.
//
// These assert structure, not data: the tracker is user data that drifts, so
// the specs check that each surface mounts with its widgets rather than that
// any particular offer or count is present.

import { expect, test } from '@playwright/test';

const HOME_VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 667 },
] as const;

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

for (const viewport of HOME_VIEWPORTS) {
  test(`waiting-on-you count matches the pending decision queue @ ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const response = await page.request.get('/api/applications');
    const data = (await response.json()) as { entries: Array<{ status: string }> };
    const expected = data.entries.filter(entry =>
      ['screened', 'evaluated'].includes(entry.status.trim().toLowerCase()),
    ).length;

    await page.goto('/');
    const card = page.locator('.agenda-card', { hasText: 'waiting on you' });
    await expect(card.locator('.agenda-card__count')).toHaveText(String(expected));
    await page.screenshot({ path: `test-results/home-waiting-count-${viewport.name}.png` });
  });
}

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
