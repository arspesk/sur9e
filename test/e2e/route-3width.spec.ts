import { expect, test } from '@playwright/test';
import { REPORT_FIXTURE } from './_fixtures';

// C3.2 — 3-width smoke tests.
// For every public route, assert that at 1280×800 (desktop), 768×1024 (tablet),
// and 375×667 (mobile) the page renders, the Topbar lands, the main region
// shows, a route-specific identifying element is visible, and there's no
// horizontal overflow. The mobile bottom-bar is asserted to be visible at
// 375 and absent (display:none → not visible) at 768 and 1280.
//
// Per CLAUDE.md: read-only. /profile + /settings have legacy PATCH/PUT writes
// triggered on hydration in some cases, so we short-circuit those to keep
// inputs/personalization/* immutable.

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 667 },
] as const;

type Viewport = (typeof VIEWPORTS)[number];

interface RouteCase {
  // Path that goes into page.goto() — root is special-cased for the redirect.
  path: string;
  // Stable name used in test titles.
  name: string;
  // Function that returns a locator for the route-specific landmark. Receives
  // the page and the viewport to allow viewport-specific overrides (e.g. /report
  // toc lines only render at desktop ≥ 1025px).
  identifier: (
    page: import('@playwright/test').Page,
    viewport: Viewport,
  ) => ReturnType<import('@playwright/test').Page['locator']>;
  // Long-running routes (report fetch, analytics aggregation) need a higher
  // timeout for the main-content ready signal.
  loadTimeoutMs?: number;
}

const ROUTES: RouteCase[] = [
  {
    path: '/',
    name: '/ (redirect to /offers)',
    identifier: page => page.locator('table.offers'),
  },
  {
    path: '/table',
    name: '/table (redirect to /offers)',
    identifier: page => page.locator('table.offers'),
  },
  {
    path: '/pipeline',
    name: '/pipeline',
    identifier: page => page.locator('.board .column').first(),
  },
  {
    path: '/profile',
    name: '/profile',
    identifier: page => page.locator('section#identity'),
  },
  {
    path: '/settings',
    name: '/settings',
    identifier: page => page.locator('section#theme'),
  },
  // /report is appended below only when a fixture exists on disk.
  {
    path: '/analytics',
    name: '/analytics',
    identifier: page => page.locator('.analytics-content'),
    loadTimeoutMs: 15_000,
  },
];

// The report route depends on user data (artifacts/reports/). Resolve the
// fixture dynamically and only register the route when one exists, so the
// 3-width smoke still runs end-to-end on a fresh OSS clone with no reports.
if (REPORT_FIXTURE) {
  ROUTES.push({
    path: `/report/${REPORT_FIXTURE}`,
    name: `/report/${REPORT_FIXTURE}`,
    identifier: page => page.locator('[data-testid="report-body"]'),
    loadTimeoutMs: 15_000,
  });
}

// Routes that mount profile/settings/table forms which may persist user data
// on hydration or via auto-save. Block those calls so the test stays
// read-only. Covers both surfaces:
//   - legacy: PATCH /api/profile, PUT /api/profile/md/**, PUT /api/settings
//   - server actions: POST to any route URL with a `next-action` header
//     (Next 16 App Router serializes server-action invocations as POST
//     requests to the page's own URL with the action ID in `next-action`).
// We short-circuit both. The action call returns a 200 with the Next
// serialized envelope (`0:{"ok":true}\n`) — that's enough to keep the
// caller's mutation promise resolved without writing to disk.
async function installReadOnlyGuard(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/profile', async (route, request) => {
    if (request.method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, profileChanged: false, portalsChanged: false }),
      });
    }
    return route.continue();
  });
  await page.route('**/api/profile/md/**', async (route, request) => {
    if (request.method() === 'PUT') {
      return route.fulfill({ status: 200, body: '' });
    }
    return route.continue();
  });
  await page.route('**/api/settings', async (route, request) => {
    if (request.method() === 'PUT' || request.method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      });
    }
    return route.continue();
  });
  await page.route('**/*', async (route, request) => {
    if (request.method() === 'POST' && request.headers()['next-action']) {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/x-component' },
        body: '0:{"ok":true,"profileChanged":false,"portalsChanged":false}\n',
      });
    }
    return route.continue();
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`@ ${viewport.name} (${viewport.width}×${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of ROUTES) {
      test(`${route.name} renders + topbar + landmark + no overflow`, async ({ page }) => {
        await installReadOnlyGuard(page);

        // Collect console errors so we can surface them with the failure
        // (cuts the next-page hunt by half).
        const consoleErrors: string[] = [];
        page.on('console', msg => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto(route.path);

        // Topbar landmark — every route in the app shell renders <header class="topbar">.
        const topbar = page.locator('header.topbar');
        await expect(topbar).toBeVisible();

        // <main> from src/app/layout.tsx (or .main from legacy chrome).
        const mainRegion = page.locator('main, .main').first();
        await expect(mainRegion).toBeVisible();

        // Route-specific landmark — fails if the route is stuck on a skeleton.
        const identifier = route.identifier(page, viewport);
        await expect(identifier.first()).toBeVisible({
          timeout: route.loadTimeoutMs ?? 10_000,
        });

        // Bottom-bar visibility contract: visible @ ≤640px, hidden above.
        const bottomBar = page.locator('.bottom-bar');
        if (viewport.width <= 640) {
          await expect(bottomBar).toBeVisible();
        } else {
          // display:none → toBeVisible() would fail; toBeHidden() passes either
          // if absent OR if present-but-not-visible.
          await expect(bottomBar).toBeHidden();
        }

        // No horizontal overflow: documentElement.scrollWidth must not exceed
        // the viewport width. A 1px tolerance covers sub-pixel rounding.
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(
          scrollWidth,
          `horizontal overflow on ${route.path} @ ${viewport.name}`,
        ).toBeLessThanOrEqual(viewport.width + 1);

        // Surface any console errors as a soft assertion — we don't fail on
        // them (Next dev mode emits a lot of noisy warnings), but a hard error
        // signal is recorded in the test output if present.
        if (consoleErrors.length > 0) {
          console.warn(
            `[${route.path} @ ${viewport.name}] console errors:\n  ${consoleErrors.join('\n  ')}`,
          );
        }
      });
    }
  });
}
