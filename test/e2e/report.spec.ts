import { expect, test } from '@playwright/test';
import { REPORT_FIXTURE, skipIfNoReport } from './_fixtures';

// Report fixture is resolved dynamically from artifacts/reports/ (user data),
// so these specs assert STRUCTURE — not the user's specific company/score —
// and skip cleanly when there are no reports on disk.

test('/report/[filename] loads and renders the report body', async ({ page }) => {
  skipIfNoReport();
  await page.goto(`/report/${REPORT_FIXTURE}`);
  // Body host appears once useReport resolves and ReportRender mounts.
  await expect(page.locator('[data-testid="report-body"]')).toBeVisible({ timeout: 10_000 });
});

test('/report/[filename] renders the hero with a non-empty company name', async ({ page }) => {
  skipIfNoReport();
  await page.goto(`/report/${REPORT_FIXTURE}`);
  const hero = page.locator('[data-testid="report-body"] .hero');
  await expect(hero).toBeVisible({ timeout: 10_000 });
  // Assert the hero h1 renders the company (structure, not a specific value).
  await expect(hero.locator('h1')).not.toBeEmpty();
});

test('/report/[filename] mounts the editable body (be-prose) below the hero', async ({ page }) => {
  skipIfNoReport();
  await page.goto(`/report/${REPORT_FIXTURE}`);
  await expect(page.locator('[data-testid="report-body"]')).toBeVisible({ timeout: 10_000 });
  // The structured-renderer action-bar + section#snapshot were removed when
  // reports became frontmatter-only; the body is now a single TipTap editor.
  await expect(page.locator('[data-testid="report-body"] .be-prose')).toBeVisible({
    timeout: 10_000,
  });
});

test('/report/[filename] renders TOC indicator lines (desktop ≥1025px)', async ({ page }) => {
  skipIfNoReport();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/report/${REPORT_FIXTURE}`);
  await expect(page.locator('[data-testid="report-body"]')).toBeVisible({ timeout: 10_000 });
  // The rail is populated from the editor's live headings, so wait for the
  // TipTap body to mount before counting (avoids a race under parallel load).
  await expect(page.locator('[data-testid="report-body"] .be-prose')).toBeVisible({
    timeout: 10_000,
  });
  // At least two heading lines must appear in the rail for a generated report.
  await expect(page.locator('#tocIndicator .toc-line').first()).toBeVisible({ timeout: 10_000 });
  const lineCount = await page.locator('#tocIndicator .toc-line').count();
  expect(lineCount).toBeGreaterThanOrEqual(2);
});

test('/report/[filename] surfaces an error message for a missing offer', async ({ page }) => {
  await page.goto('/report/999-does-not-exist-2026-05-15.md');
  await expect(page.locator('[data-testid="report-error"]')).toBeVisible({ timeout: 10_000 });
});
