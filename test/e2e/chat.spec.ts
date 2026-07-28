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
  let messages: Array<Record<string, unknown>> = [];
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
      body: JSON.stringify({ session: CONVERSATION, messages }),
    }),
  );
  await page.route('**/api/chat/sessions/c1/turns', route => {
    const { message } = route.request().postDataJSON() as { message: string };
    messages = [
      {
        id: 'u1',
        conversationId: 'c1',
        role: 'user',
        content: message,
        events: null,
        versionGroup: null,
        attachments: null,
        referencedOffers: null,
        position: 0,
        createdAt: '2026-07-18T10:01:00.000Z',
      },
    ];
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ turnId: 't1', userMessageId: 'u1' }),
    });
  });
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
      await expect(dialog.locator('.chat-msg--user')).toHaveCount(1);
      await expect(dialog.getByText('how many offers?', { exact: true })).toHaveCount(1);

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

for (const viewport of VIEWPORTS) {
  test(`new full-page thread never flashes the empty state @ ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const conversation = {
      ...CONVERSATION,
      id: '7f304111-b9e7-4cdd-9da9-63a6745d060d',
      title: 'New response',
    };
    let messages: Array<Record<string, unknown>> = [];

    await page.route('**/api/chat/sessions', async route => {
      if (route.request().method() === 'POST') {
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ session: conversation }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [] }),
      });
    });
    await page.route(`**/api/chat/sessions/${conversation.id}`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: conversation, messages }),
      }),
    );
    await page.route(`**/api/chat/sessions/${conversation.id}/turns`, async route => {
      const { message } = route.request().postDataJSON() as { message: string };
      // Keep the newly-created session genuinely empty long enough to expose the
      // route-remount race. The UI must retain the optimistic turn meanwhile.
      await new Promise(resolve => setTimeout(resolve, 600));
      messages = [
        {
          id: 'u-new',
          conversationId: conversation.id,
          role: 'user',
          content: message,
          events: null,
          versionGroup: null,
          attachments: null,
          referencedOffers: null,
          position: 0,
          createdAt: '2026-07-18T10:01:00.000Z',
        },
      ];
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ turnId: 't-new', userMessageId: 'u-new' }),
      });
    });
    await page.route('**/api/chat/turns/t-new', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'running' }),
      }),
    );
    await page.route('**/api/chat/turns/t-new/events**', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: sse([{ seq: 1, type: 'text-delta', text: 'Replying now' }]),
      });
    });
    await page.route('**/api/providers', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: {} }),
      }),
    );

    await page.goto('/chat');
    const mobile = viewport.width <= 640;
    if (mobile) {
      await expect.poll(() => new URL(page.url()).pathname).toBe('/');
      await expect(page.getByRole('dialog', { name: 'sur9e chat' })).toBeVisible();
    }
    const surface = mobile
      ? page.getByRole('dialog', { name: 'sur9e chat' })
      : page.locator('#main');
    const input = surface.getByRole('textbox', { name: 'Message' });
    await input.fill('start a fresh response');
    await input.press('Enter');
    await expect(surface.locator('.chat-empty')).toBeHidden();

    await page.evaluate(() => {
      Reflect.set(window, '__emptyChatFlashSeen', false);
      const observer = new MutationObserver(() => {
        if (document.querySelector('.chat-empty')) {
          Reflect.set(window, '__emptyChatFlashSeen', true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      Reflect.set(window, '__emptyChatFlashObserver', observer);
    });

    if (mobile) {
      await page.waitForTimeout(1100);
    } else {
      await expect.poll(() => new URL(page.url()).pathname).toBe(`/chat/${conversation.id}`);
      await page.waitForTimeout(300);
    }
    expect(await page.evaluate(() => Reflect.get(window, '__emptyChatFlashSeen'))).toBe(false);
    await page.screenshot({ path: `test-results/chat-no-empty-flash-${viewport.name}.png` });
  });
}

for (const viewport of VIEWPORTS) {
  test(`resolved offer workflow keeps its result link readable @ ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const resultConversation = {
      ...CONVERSATION,
      id: '8d924992-e54e-464d-8432-f70be25b251f',
      title: 'Created offer workflow',
    };
    const messages = [
      {
        id: 'u-result',
        conversationId: resultConversation.id,
        role: 'user',
        content: 'Create and evaluate this offer',
        events: null,
        versionGroup: null,
        attachments: null,
        referencedOffers: null,
        position: 0,
        createdAt: '2026-07-18T10:01:00.000Z',
      },
      {
        id: 'a-result',
        conversationId: resultConversation.id,
        role: 'assistant',
        content: '',
        events: [
          {
            seq: 1,
            type: 'confirm',
            token: 'tok-result',
            summary: 'Create, screen, and evaluate offer',
            meta: 'local tracker write · then start screen + evaluate',
            kind: 'create-offer-from-text',
          },
          {
            seq: 2,
            type: 'confirm-resolved',
            token: 'tok-result',
            outcome: 'approved',
            execution: 'succeeded',
            message: 'Offer #42 created. Screening and evaluation started.',
            links: [{ label: 'Offer #42', href: '/report/42' }],
          },
        ],
        versionGroup: null,
        attachments: null,
        referencedOffers: null,
        position: 1,
        createdAt: '2026-07-18T10:02:00.000Z',
      },
    ];
    await page.route('**/api/chat/sessions', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [resultConversation] }),
      }),
    );
    await page.route(`**/api/chat/sessions/${resultConversation.id}`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: resultConversation, messages }),
      }),
    );
    await page.route('**/api/providers', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: {} }),
      }),
    );

    await page.goto(`/chat/${resultConversation.id}`);
    await suppressDevOverlay(page);
    const surface =
      viewport.width <= 640
        ? page.getByRole('dialog', { name: 'sur9e chat' })
        : page.locator('#main');
    await expect(surface).toBeVisible();
    if (viewport.width <= 640) {
      await surface.getByRole('button', { name: 'Switch chat session' }).click();
      await page.getByRole('button', { name: resultConversation.title, exact: true }).click();
    }
    const card = surface.locator('.chat-confirm');
    await expect(card).toBeVisible();
    await expect(
      card.getByText('Offer #42 created. Screening and evaluation started.'),
    ).toBeVisible();
    const link = card.getByRole('link', { name: 'Offer #42' });
    await expect(link).toHaveAttribute('href', '/report/42');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width + 1);
    await page.screenshot({ path: `test-results/chat-offer-result-${viewport.name}.png` });
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
