import { expect, type Page, type Request, type Route, test } from '@playwright/test';

// Large-offer-sets design (2026-06-10): the offers table windows its rows
// through @tanstack/react-virtual and the kanban board windows each column
// to 25 cards + a "Show 25 more" expander (Discarded collapses to a count
// stub). These smokes drive the user-visible contract:
//   - the scrollbar spans the FULL filtered set and the last row is
//     reachable + opens its drawer
//   - the DOM stays bounded no matter how many offers are tracked
//   - scroll position survives drawer open/close
//   - the Discarded stub composes with the per-column window
//   - dropping a card into a column fires the status PATCH (stubbed — no
//     user data is touched) regardless of expansion state
//   - typing + erasing a search stays under a main-thread budget and the
//     URL settles promptly after the erase
//
// Every test skips cleanly when the tracker is too small for the windowing
// to engage (fresh OSS clone).

// Mounted rows ≈ viewport/58px + 2×10 overscan ≈ 40; anything ≤80 proves
// windowing (vs. the old behavior of mounting all 550+).
const MAX_MOUNTED_ROWS = 80;

async function applicationCount(page: Page): Promise<number> {
  const res = await page.request.get('/api/applications');
  if (!res.ok()) return 0;
  const body = (await res.json()) as { count?: number };
  return body.count ?? 0;
}

/**
 * Wait until the table is hydrated — useCellClipFade stamps data-clip-hook
 * in a post-mount effect, so its presence means React owns the DOM and the
 * virtualizer is attached. (Scrolling the raw SSR markup is a legitimate
 * but separate scenario; these smokes assert steady-state behavior.)
 */
async function waitForHydratedTable(page: Page): Promise<void> {
  await page.waitForSelector('table.offers[data-clip-hook] tbody tr.offers-row');
}

test.describe('virtualized offers table', () => {
  test('scrolls to the last row, opens its drawer, keeps the DOM bounded', async ({ page }) => {
    const count = await applicationCount(page);
    test.skip(count < 60, 'tracker too small for windowing to engage');

    await page.goto('/offers');
    await waitForHydratedTable(page);

    // Bounded DOM at the top of the list.
    const mountedTop = await page.locator('tbody tr.offers-row').count();
    expect(mountedTop).toBeLessThanOrEqual(MAX_MOUNTED_ROWS);

    // aria-rowcount announces the real set despite the windowed DOM.
    await expect(page.locator('table.offers')).toHaveAttribute('aria-rowcount', String(count + 1));

    // Scroll the wrap (the table's real scroll container) to the very end.
    await page.evaluate(() => {
      const wrap = document.querySelector('.table-wrap');
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    });
    const lastRow = page.locator(`tbody tr.offers-row[data-index="${count - 1}"]`);
    await expect(lastRow).toBeVisible();

    const mountedBottom = await page.locator('tbody tr.offers-row').count();
    expect(mountedBottom).toBeLessThanOrEqual(MAX_MOUNTED_ROWS);

    // The last row opens its drawer like any other row.
    await lastRow.locator('.col-co').click();
    await expect(page.locator('.cd-drawer.on')).toBeVisible();
  });

  test('scroll offset survives drawer open/close', async ({ page }) => {
    const count = await applicationCount(page);
    test.skip(count < 60, 'tracker too small for windowing to engage');

    await page.goto('/offers');
    await waitForHydratedTable(page);

    await page.evaluate(() => {
      const wrap = document.querySelector('.table-wrap');
      if (wrap) wrap.scrollTop = Math.floor(wrap.scrollHeight / 2);
    });
    await expect
      .poll(() => page.evaluate(() => document.querySelector('.table-wrap')?.scrollTop ?? 0))
      .toBeGreaterThan(0);

    // Click a row that is VISIBLE in the scrollport — the window also mounts
    // overscan rows outside it, and clicking one of those would make the
    // user agent scroll it into view (a click-side effect, not drawer
    // behavior, which is what this test measures).
    const findVisibleIndex = () =>
      page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        if (!wrap) return null;
        const wrapRect = wrap.getBoundingClientRect();
        for (const row of wrap.querySelectorAll('tbody tr.offers-row')) {
          const r = row.getBoundingClientRect();
          if (r.top >= wrapRect.top && r.bottom <= wrapRect.bottom) {
            return row.getAttribute('data-index');
          }
        }
        return null;
      });
    // The window for the new offset commits on the next React render —
    // poll until a row is actually inside the scrollport.
    await expect.poll(findVisibleIndex).not.toBeNull();
    const visibleIndex = await findVisibleIndex();
    await page.locator(`tbody tr.offers-row[data-index="${visibleIndex}"] .col-co`).click();
    await expect(page.locator('.cd-drawer.on')).toBeVisible();

    // The contract under test: open → close must return to the same offset.
    // (The click itself may nudge the offset — user-agent scroll-into-view
    // mechanics — so the baseline is taken with the drawer open.)
    const before = await page.evaluate(() => document.querySelector('.table-wrap')?.scrollTop ?? 0);
    expect(before).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('.cd-drawer.on')).toHaveCount(0);

    const after = await page.evaluate(() => document.querySelector('.table-wrap')?.scrollTop ?? 0);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });

  test('typing + erasing a search stays within the main-thread budget', async ({ page }) => {
    const count = await applicationCount(page);
    test.skip(count < 60, 'tracker too small for the perf assertion to mean anything');

    await page.goto('/offers');
    await waitForHydratedTable(page);

    await page.evaluate(() => {
      (window as unknown as { __longTaskMs: number }).__longTaskMs = 0;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          (window as unknown as { __longTaskMs: number }).__longTaskMs += entry.duration;
        }
      }).observe({ type: 'longtask' });
    });

    const search = page.locator('#table-search');
    await search.click();
    await search.pressSequentially('engineer', { delay: 50 });
    for (let i = 0; i < 'engineer'.length; i++) {
      await page.keyboard.press('Backspace');
    }

    // URL settles promptly after the erase (the old all-rows render starved
    // this for ~3s).
    await expect
      .poll(() => page.evaluate(() => location.search.includes('q=')), {
        timeout: 3000,
      })
      .toBe(false);

    // Generous CI headroom; the pre-virtualization worst case measured in
    // whole seconds, the windowed table measures ~0ms locally.
    const longTaskMs = await page.evaluate(
      () => (window as unknown as { __longTaskMs: number }).__longTaskMs,
    );
    expect(longTaskMs).toBeLessThan(1500);
  });
});

test.describe('kanban column windows', () => {
  test('Discarded stub expands to a 25-card window, then 25 more', async ({ page }) => {
    await page.goto('/offers?view=kanban');
    await page.waitForSelector('.board .column');

    const discarded = page.locator('.column[data-status="discarded"]');
    const total = Number((await discarded.locator('.col-count').textContent()) ?? '0');
    test.skip(total <= 25, 'not enough discarded cards for the stub + window to engage');

    // Collapsed stub by default — no cards mounted.
    await expect(discarded.locator('.card')).toHaveCount(0);
    await discarded.getByRole('button', { name: 'Show cards' }).click();

    // Windowed, not the full set.
    await expect(discarded.locator('.card')).toHaveCount(25);
    await discarded.getByRole('button', { name: /^Show \d+ more/ }).click();
    await expect(discarded.locator('.card')).toHaveCount(Math.min(50, total));

    // Every column stays bounded by its window.
    for (const column of await page.locator('.board .column').all()) {
      expect(await column.locator('.card').count()).toBeLessThanOrEqual(50);
    }
  });

  test('dropping a card into a column fires the status PATCH (stubbed)', async ({ page }) => {
    // Server actions are stubbed so the user's tracker is never touched
    // (same convention as mutations.spec.ts). Other actions (revalidation,
    // prefetch) also POST with a next-action header, so keep every body and
    // look for the status payload among them.
    const bodies: string[] = [];
    await page.route('**/*', async (route: Route) => {
      const request: Request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) {
        bodies.push(request.postData() ?? '');
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/x-component' },
          body: '0:{"ok":true}\n',
        });
      }
      return route.continue();
    });

    await page.goto('/offers?view=kanban');
    await page.waitForSelector('.board .column .card');

    // Drop INTO a column works regardless of its expansion state — the
    // collapsed Discarded column is the strictest case (it mounts zero
    // cards), so prefer it as the target whenever it exists. The dispatch
    // retries because React may still be hydrating on the first attempt
    // (synthetic DragEvents are inert until the handlers attach).
    const dispatchDrag = () =>
      page.evaluate(() => {
        const card = document.querySelector<HTMLElement>(
          '.column:not([data-status="evaluated"]):not([data-status="discarded"]) .card',
        );
        if (!card) return null;
        const source = card.closest<HTMLElement>('.column');
        const target =
          document.querySelector<HTMLElement>('.column[data-status="discarded"]') ??
          document.querySelector<HTMLElement>(
            `.column:not([data-status="evaluated"]):not([data-status="${source?.dataset.status}"])`,
          );
        if (!target || !source || target === source) return null;
        const dataTransfer = new DataTransfer();
        const opts = { bubbles: true, cancelable: true, dataTransfer };
        card.dispatchEvent(new DragEvent('dragstart', opts));
        target.dispatchEvent(new DragEvent('dragover', opts));
        target.dispatchEvent(new DragEvent('drop', opts));
        card.dispatchEvent(new DragEvent('dragend', opts));
        return { num: Number(card.dataset.num), to: target.dataset.status ?? '' };
      });

    const patchCaptured = (dragged: { num: number; to: string }) =>
      bodies.some(b => b.includes(`"num":${dragged.num}`) && b.includes(dragged.to));

    let dragged: { num: number; to: string } | null = null;
    for (let attempt = 0; attempt < 5 && (dragged === null || !patchCaptured(dragged)); attempt++) {
      dragged = await dispatchDrag();
      if (dragged) await page.waitForTimeout(700);
    }
    test.skip(dragged === null, 'no draggable card / target column pair on the board');
    if (dragged === null) return;
    expect(patchCaptured(dragged)).toBe(true);
  });
});
