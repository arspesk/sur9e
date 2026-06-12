import { expect, test } from '@playwright/test';
import { REPORT_FIXTURE, skipIfNoReport } from './_fixtures';

// Regression: the TipTap editor used to register the `underline` mark twice —
// once via StarterKit's bundled Underline (3.24.0 registers it unless
// `underline: false` is passed) and once via a standalone Underline import in
// src/components/editor/tiptap-editor.tsx. The duplicate emitted a runtime
// warning on every editor mount:
//   [tiptap warn]: Duplicate extension names found: ['underline'].
// This spec captures console output across the report editor mount and asserts
// no such warning fires. Read-only: navigation + console capture only.

test('report editor mounts without a duplicate-extension tiptap warning', async ({ page }) => {
  skipIfNoReport();

  const tiptapWarnings: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[tiptap warn]') && text.includes('Duplicate extension names')) {
      tiptapWarnings.push(text);
    }
  });

  await page.goto(`/report/${REPORT_FIXTURE}`);
  // Wait for the editor to fully mount (the moment any duplicate registration
  // warning would fire).
  await expect(page.locator('[data-testid="report-body"] .be-prose')).toBeVisible({
    timeout: 10_000,
  });

  expect(tiptapWarnings).toEqual([]);
});
