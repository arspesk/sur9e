/* table-boot.ts
 *
 * Anti-flash boot script for the offers table, rendered as an inline
 * <script> right after the .table-wrap markup so it executes during HTML
 * parse — before first paint and before React hydrates.
 *
 * Without it the first paint uses browser-computed auto column widths and
 * no edge fade; the saved layout then snaps in when useRowResize /
 * useScrollEdgeFade mount, which reads as a layout jump on every load.
 *
 * It deliberately mutates NOTHING inside React's tree (no th styles, no
 * data attributes) — it only appends <style> tags to <head>, which React
 * never reconciles, so there is no hydration-mismatch risk:
 *   #table-boot-widths — saved column widths from localStorage as CSS rules
 *     (useRowResize later sets the same values as inline styles, which win;
 *     "Reset layout" removes this tag — see use-row-resize.ts).
 *   #table-boot-fade — the right edge fade, applied only while the
 *     scroll-edge hook hasn't run yet (:not([data-fade-right]) stops
 *     matching the moment useScrollEdgeFade stamps the attribute).
 *
 * One deliberate exception to the no-React-DOM rule: `.is-clipped` is
 * pre-marked on the first ~40 rows' cells (mirroring useCellClipFade's
 * selector semantics) so the cell fade doesn't pop in after hydration.
 * React's hydration verifies structure and text, not class attributes, so
 * the extra class survives; useCellClipFade re-marks everything at mount
 * anyway, making the boot pass purely cosmetic. Capped at 40 rows to keep
 * the parse-time layout reads ~1 viewport deep, not 552 rows deep.
 *
 * localStorage is untrusted input: keys/values are validated before being
 * interpolated into CSS.
 */

export function tableBootScript(storageKey: string): string {
  return `(() => {
  try {
    if (document.getElementById('table-boot-widths') || document.getElementById('table-boot-fade')) return;
    var raw = localStorage.getItem(${JSON.stringify(storageKey)});
    var css = '';
    if (raw) {
      var w = JSON.parse(raw);
      for (var k in w) {
        if (/^col-[a-z0-9-]+$/.test(k) && isFinite(w[k]) && w[k] >= 40 && w[k] <= 2000)
          css += 'table.offers thead th.' + k + '{width:' + Math.round(w[k]) + 'px}';
      }
      if (css) css = 'table.offers{table-layout:fixed}' + css;
    }
    if (css) {
      var s = document.createElement('style');
      s.id = 'table-boot-widths';
      s.textContent = css;
      document.head.appendChild(s);
    }
    // The table body streams in a later HTML chunk (Suspense), and Next's
    // relocation can REPLACE early-streamed rows wholesale — a single
    // mark pass gets wiped with the DOM it marked. So: a pre-paint rAF
    // loop that re-marks whenever the row set changes, and exits when
    // useCellClipFade signals it has taken over (data-clip-hook on the
    // table) or after a ~20s safety cap. Per-frame work when nothing
    // changed is two queries; mark passes are capped at 40 rows.
    var frames = 0;
    var lastRows = -1;
    var lastFirst = null;
    var markLoop = function () {
      var table = document.querySelector('table.offers');
      if (table && table.hasAttribute('data-clip-hook')) return;
      if (++frames > 1200) return;
      var wrap = document.querySelector('.table-wrap');
      var rows = wrap ? wrap.querySelectorAll('tbody tr') : [];
      if (!rows.length || !wrap.offsetWidth) {
        requestAnimationFrame(markLoop);
        return;
      }
      if (rows.length !== lastRows || rows[0] !== lastFirst) {
        lastRows = rows.length;
        lastFirst = rows[0];
        var overflow = wrap.scrollWidth - wrap.clientWidth > 1;
        var fadeTag = document.getElementById('table-boot-fade');
        if (overflow && !fadeTag) {
          var f = document.createElement('style');
          f.id = 'table-boot-fade';
          f.textContent = '.table-wrap:not([data-fade-right]){--edge-r:32px}';
          document.head.appendChild(f);
        } else if (!overflow && fadeTag) {
          fadeTag.remove();
        }
        var lim = Math.min(rows.length, 40);
        for (var i = 0; i < lim; i++) {
          var cells = rows[i].querySelectorAll('td');
          for (var j = 0; j < cells.length; j++) {
            var c = cells[j];
            if (c.classList.contains('col-select') || c.classList.contains('col-kebab')) continue;
            var t = c.classList.contains('col-co') ? c.querySelector('.cell-co__name') || c : c;
            if (t.scrollWidth - t.clientWidth > 2) t.classList.add('is-clipped');
          }
        }
      }
      requestAnimationFrame(markLoop);
    };
    requestAnimationFrame(markLoop);
  } catch (e) {}
})();`;
}
