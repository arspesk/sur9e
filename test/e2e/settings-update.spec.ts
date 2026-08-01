import { expect, type Page, test } from '@playwright/test';

const JOB_ID = '26cf6d7a-2763-4b9d-b539-930fa8414bd5';
const SETTINGS_HREF = '/settings?view=system#system';

const availableCheck = {
  status: 'update-available',
  local: '0.3.2',
  remote: '0.4.0',
  changelog: 'Faster restart. Improved update recovery without touching your personal data.',
} as const;

function job(phase: string) {
  const active = [
    'applying',
    'stopping',
    'rebuilding',
    'restarting',
    'verifying',
    'recovering',
  ].includes(phase);
  return {
    id: JOB_ID,
    phase,
    mode: { prod: false, tailscale: false },
    fromVersion: '0.3.2',
    toVersion: '0.4.0',
    createdAt: '2026-07-31T20:00:00.000Z',
    updatedAt: '2026-07-31T20:00:00.000Z',
    ...(active ? { launchState: 'owned', pid: 4242 } : { launchState: 'claim-pending' }),
  };
}

async function stubReadOnlySystemEndpoints(page: Page) {
  await page.route('**/api/version', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"0.3.2"}' }),
  );
  await page.route('**/api/update/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/update/check' && route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(availableCheck),
      });
    }
    if (pathname === '/api/update/rollback' && route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}',
      });
    }
    return route.fulfill({
      status: 418,
      contentType: 'application/json',
      body: JSON.stringify({ error: `Unexpected stubbed update request: ${pathname}` }),
    });
  });
}

test('runs the one-click update flow through restart downtime and restores the exact URL', async ({
  page,
}) => {
  test.setTimeout(40_000);

  let installedVersion = '0.3.2';
  let checkCalls = 0;
  let applyCalls = 0;
  let rollbackCalls = 0;
  let statusCalls = 0;
  let statusPhase = 'queued';
  let failStatus = false;
  const unexpectedRequests: string[] = [];

  await page.route('**/api/version', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: installedVersion }),
    }),
  );
  await page.route('**/api/update/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/update/check' && request.method() === 'GET') {
      checkCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(availableCheck),
      });
    }
    if (pathname === '/api/update/apply' && request.method() === 'POST') {
      applyCalls += 1;
      expect(request.postDataJSON()).toEqual({ toVersion: '0.4.0' });
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ jobId: JOB_ID }),
      });
    }
    if (pathname === `/api/update/status/${JOB_ID}` && request.method() === 'POST') {
      statusCalls += 1;
      if (failStatus) return route.abort('connectionfailed');
      if (statusPhase === 'succeeded') installedVersion = '0.4.0';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(job(statusPhase)),
      });
    }
    if (pathname === '/api/update/rollback' && request.method() === 'POST') {
      rollbackCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}',
      });
    }

    unexpectedRequests.push(`${request.method()} ${pathname}`);
    return route.fulfill({
      status: 418,
      contentType: 'application/json',
      body: '{"error":"unexpected update endpoint"}',
    });
  });

  await page.goto(SETTINGS_HREF);
  await page.waitForLoadState('networkidle');
  const section = page.locator('section#system');
  await expect(section.getByText('Not checked yet')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Update now' })).toHaveCount(0);

  await section.getByRole('button', { name: 'Check for updates' }).click();
  await expect(section.getByText('v0.4.0 available')).toBeVisible();
  await expect(section.getByText(availableCheck.changelog)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Update now' })).toBeVisible();

  await section.getByRole('button', { name: 'Update now' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Update Sur9e from v0.3.2 to v0.4.0?',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'Sur9e will briefly go offline while it updates and restarts in this tab.',
  );
  await expect(dialog).toContainText('v0.3.2 → v0.4.0');
  await expect(dialog).toContainText('Your CV, profile, tracker, and reports are untouched.');
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const confirm = dialog.getByRole('button', { name: 'Update now' });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  const returnNavigation = page.waitForEvent('framenavigated', {
    predicate: frame => frame === page.mainFrame(),
    timeout: 30_000,
  });
  await page.keyboard.press('Enter');

  await expect(section.getByRole('status')).toContainText('Starting update');
  statusPhase = 'rebuilding';
  await expect(section.getByRole('status')).toContainText('Rebuilding', { timeout: 8_000 });
  statusPhase = 'restarting';
  await expect(section.getByRole('status')).toContainText('Restarting', { timeout: 8_000 });
  failStatus = true;
  await expect(section.getByRole('status')).toContainText('Reconnecting', { timeout: 15_000 });
  failStatus = false;
  statusPhase = 'verifying';
  await expect(section.getByRole('status')).toContainText('Verifying restart', { timeout: 8_000 });
  statusPhase = 'succeeded';

  await returnNavigation;
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(url => {
    const actual = new URL(url);
    return `${actual.pathname}${actual.search}${actual.hash}` === SETTINGS_HREF;
  });
  await expect(page.locator('section#system').getByRole('status')).toContainText(
    'Update complete',
    {
      timeout: 10_000,
    },
  );
  expect(checkCalls).toBe(1);
  expect(applyCalls).toBe(1);
  expect(rollbackCalls).toBe(0);
  expect(statusCalls).toBeGreaterThanOrEqual(6);
  expect(unexpectedRequests).toEqual([]);

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('section#system').getByText('Not checked yet')).toBeVisible();
  await expect(page.locator('section#system').getByText('Update complete')).toHaveCount(0);
  await expect(page.locator('#aboutVersion')).toHaveText('v0.4.0');
});

test('consumes an automatic rollback notice for one load', async ({ page }) => {
  await stubReadOnlySystemEndpoints(page);
  await page.goto(SETTINGS_HREF);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      'sur9e.update.result',
      JSON.stringify({ kind: 'rolled-back', version: '0.3.2', error: 'Build failed' }),
    );
  });

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('section#system').getByRole('status')).toContainText(
    'Recovered automatically',
  );
  await expect(
    page.getByRole('status').filter({ hasText: 'automatically recovered v0.3.2' }),
  ).toBeVisible();

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('section#system').getByText('Not checked yet')).toBeVisible();
  await expect(page.getByText(/automatically recovered v0\.3\.2/i)).toHaveCount(0);
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 667 },
]) {
  test(`${viewport.name} keeps update controls visible, keyboard-accessible, and overflow-free`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await stubReadOnlySystemEndpoints(page);
    await page.goto(SETTINGS_HREF);
    await page.waitForLoadState('networkidle');

    const section = page.locator('section#system');
    await section.scrollIntoViewIfNeeded();
    const check = section.getByRole('button', { name: 'Check for updates' });
    const edit = section.locator('button[aria-controls="system-update-source-fields"]');
    const rollback = section.getByRole('button', { name: 'Roll back' });
    await expect(check).toBeVisible();
    await expect(edit).toBeVisible();
    await expect(rollback).toBeVisible();

    await edit.focus();
    await expect(edit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(edit).toHaveAttribute('aria-expanded', 'true');
    await expect(section.getByRole('textbox', { name: 'Update source' })).toBeVisible();
    await expect(section.getByRole('textbox', { name: 'Update branch' })).toBeVisible();

    await page.screenshot({
      path: `test-results/settings-update-panel-${viewport.name}-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });

    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  });
}
