import { expect, test } from '@playwright/test';

// 3-width chat smoke: bubble → open → send → mocked SSE reply renders
// (markdown, tool chip, usage line), mobile is a full-screen takeover,
// and the document never overflows horizontally. All /api/chat/* traffic
// (plus /api/providers, which spawns CLI probes) is mocked — the suite runs
// without the chat backend / any provider CLI installed and writes nothing.

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 667 },
] as const;

const CONVERSATION = {
  id: 'c1',
  title: 'Chat',
  mode: 'chat',
  archived: false,
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
};

function sse(events: Array<{ seq: number }>): string {
  return events.map(e => `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** Next dev mode mounts a `<nextjs-portal>` error-indicator badge in the
 * bottom-right corner whenever ANY request on the page hits a server error
 * — unrelated to chat (repro: ChromeEffects' theme-bootstrap `loadSettingsAction`
 * call fires on every page and currently 500s on a cold Turbopack compile,
 * see the Task 13 report). That badge sits in the exact corner the chat
 * bubble lives in and swallows its clicks. Things that didn't fully hold up
 * under repro: a DOM-removal MutationObserver (loses the race when the
 * overlay reconnects repeatedly), `pointer-events: none` on the host (the
 * overlay renders inside a shadow root whose own stylesheet resets
 * pointer-events on its interactive children, overriding the host's
 * inherited value), and injecting the `display: none` rule via
 * `addInitScript` (runs before `document.head`/`documentElement` exist, so
 * the `appendChild` silently no-ops). Calling `page.addStyleTag` right
 * after `goto` — once the document is guaranteed to exist — is what
 * actually lands the rule; a plain CSS selector then applies to every
 * matching element regardless of when the overlay (re)mounts. It's
 * dev-tool chrome, not product UI, so neutralizing it in this suite is safe.
 */
async function suppressDevOverlay(page: import('@playwright/test').Page): Promise<void> {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

/** Click the "Open chat" bubble. At ≤640px, tokens.css puts --z-chat (85)
 * below --z-bottom-bar (100): the bubble is 56×56 at right:24/bottom:24,
 * and the mobile bottom-bar (64px tall, full width) genuinely covers its
 * bottom ~40px — a plain center-point tap lands on the bottom-bar's last
 * tab (Settings) and navigates away instead of opening chat (confirmed via
 * a live probe; see the Task 13 report). Only a ~16px strip at the very
 * top of the circle is unobstructed, so target that instead of faking a
 * force-click through the real occluding element.
 */
async function openChatBubble(page: import('@playwright/test').Page, width: number): Promise<void> {
  const bubble = page.getByRole('button', { name: 'Open chat' });
  await expect(bubble).toBeVisible();
  if (width <= 640) {
    await bubble.click({ position: { x: 28, y: 4 } });
  } else {
    await bubble.click();
  }
}

async function mockChatApi(page: import('@playwright/test').Page): Promise<void> {
  // Sessions collection: GET lists (empty — a brand-new chat), POST creates
  // conversation c1. The committed routes answer `{ sessions }` / `{ session }`
  // (not `{ conversations }` / `{ conversation }`) — see the doc comment atop
  // src/hooks/use-chat-sessions.ts.
  await page.route('**/api/chat/sessions', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: CONVERSATION }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [] }),
    });
  });
  await page.route('**/api/chat/sessions/c1', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session: CONVERSATION, messages: [] }),
    }),
  );
  await page.route('**/api/chat/sessions/c1/turns', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ turnId: 't1' }),
    }),
  );
  await page.route('**/api/chat/turns/t1/events**', route =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: sse([
        { seq: 1, type: 'stage', label: 'reading tracker' },
        { seq: 2, type: 'tool', name: 'get_tracker', status: 'start' },
        { seq: 3, type: 'tool', name: 'get_tracker', status: 'done' },
        { seq: 4, type: 'text-delta', text: 'You have **3 offers** in play.' },
        {
          seq: 5,
          type: 'usage',
          costUsd: 0.14,
          inputTokens: 1000,
          outputTokens: 200,
          model: 'test-model',
        },
        { seq: 6, type: 'done', messageId: 'm1' },
      ] as Array<{ seq: number }>),
    }),
  );
  // ModelChip (chat-header) reads /api/providers regardless of chat state —
  // the real route spawns `claude`/`codex`/`opencode` CLI probes, which is
  // both slow and environment-dependent. Stub it empty; the chip falls back
  // to its hardcoded provider·model defaults either way.
  await page.route('**/api/providers', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ providers: {} }),
    }),
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(`chat @ ${viewport.name} (${viewport.width}×${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('bubble → open → send → streamed reply', async ({ page }) => {
      await mockChatApi(page);
      await page.goto('/offers');
      await suppressDevOverlay(page);
      // The (unmocked, real) offers table's own loading skeleton can be
      // wider than the viewport for the brief instant before real rows
      // land — unrelated to chat, and the same reason route-3width.spec.ts
      // waits for a real row before its own scrollWidth check. Match that
      // so this test measures what chat itself contributes, not incidental
      // table-load timing noise.
      await expect(page.locator('table.offers tbody tr').first()).toBeVisible({
        timeout: 15_000,
      });

      await openChatBubble(page, viewport.width);

      const dialog = page.getByRole('dialog', { name: 'sur9e chat' });
      await expect(dialog).toBeVisible();

      if (viewport.width <= 640) {
        // Full-screen takeover: the card spans the whole viewport.
        const box = await dialog.boundingBox();
        expect(box?.width).toBe(viewport.width);
        expect(box?.x).toBe(0);
      }

      await page.getByRole('textbox', { name: 'Message' }).fill('how many offers?');
      await page.keyboard.press('Enter');

      await expect(dialog.getByText('3 offers')).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText('get_tracker')).toBeVisible();
      await expect(dialog.getByText('· $0.14')).toBeVisible();

      // iOS rule: the document itself never scrolls horizontally. Polled
      // rather than a one-shot read — the (unmocked, real) offers table
      // behind the chat card can cycle back into its own loading skeleton
      // mid-test (a background revalidation, unrelated to chat) and that
      // skeleton is itself wider than the viewport; give it a window to
      // settle back to real data rather than flaking on that unrelated
      // transient state.
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 })
        .toBeLessThanOrEqual(viewport.width + 1);

      // Let the card's one-time chatSlideIn entrance (--dur-sheet, 280ms)
      // fully settle before the screenshot — grabbing mid-animation composites
      // the still-transparent card over the offers table behind it.
      await page.waitForTimeout(350);
      await page.screenshot({ path: `test-results/chat-${viewport.name}.png` });
    });

    test('slash popover opens from "/" and inserts a mode', async ({ page }) => {
      await mockChatApi(page);
      await page.goto('/offers');
      await suppressDevOverlay(page);
      await openChatBubble(page, viewport.width);
      const input = page.getByRole('textbox', { name: 'Message' });
      await input.fill('/');
      await expect(page.getByRole('listbox', { name: 'Chat modes' })).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(input).toHaveValue('/offers ');
    });
  });
}

// Extra: the collapsed bubble on its own, captured at desktop width only —
// not part of the 3-width matrix above, just a convenience shot for the
// visual-review checklist.
test('collapsed bubble screenshot @ desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockChatApi(page);
  await page.goto('/offers');
  await suppressDevOverlay(page);
  // Wait past the table's loading skeleton so the convenience shot reflects
  // real data, not a mid-transition frame.
  await expect(page.locator('table.offers tbody tr').first()).toBeVisible({ timeout: 15_000 });
  const bubble = page.getByRole('button', { name: 'Open chat' });
  await expect(bubble).toBeVisible();
  await page.screenshot({ path: 'test-results/chat-bubble-desktop.png' });
});
