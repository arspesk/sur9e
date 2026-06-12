import { expect, test } from '@playwright/test';

// Regression: the rail brand wordmark is the above-the-fold LCP on /offers
// (the offers table hydrates behind a skeleton, so the rail wordmark is the
// leading LCP candidate at first paint). It previously rendered with
// next/image's default loading="lazy" and no preload, producing a Next.js
// LCP console warning in dev and a lazily-loaded LCP image in prod.
//
// The default (light) wordmark now carries `priority`, which emits
// loading="eager" + fetchpriority=high + a <link rel="preload" as="image">.
// The dark variant stays lazy (it is display:none in the light theme, so
// priority-loading it would preload an unused asset). Read-only — no mutations.

test('/offers eager-loads the LCP wordmark and emits a preload link (desktop)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/offers');

  // Light wordmark is the visible/default LCP candidate: must NOT be lazy.
  // (next/image with `priority` omits the `loading` attribute in the hydrated
  // DOM rather than setting loading="eager"; the robust, hydration-stable
  // signal that priority took effect is the preload <link> below.)
  const lightWordmark = page.locator('img.rail-brand-wordmark.light');
  await expect(lightWordmark).not.toHaveAttribute('loading', 'lazy');

  // Next emits a preload <link> for the priority image — the definitive
  // proof that `priority` (eager fetch + fetchpriority=high) is wired up.
  const preload = page.locator(
    'link[rel="preload"][as="image"][imagesrcset*="sur9e-wordmark-black"]',
  );
  await expect(preload).toHaveCount(1);
});

test('/offers leaves the hidden dark wordmark lazily loaded (desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/offers');

  // Dark variant is display:none in the light theme — keep it lazy so we don't
  // preload an unused asset.
  const darkWordmark = page.locator('img.rail-brand-wordmark.dark');
  await expect(darkWordmark).toHaveAttribute('loading', 'lazy');
});
