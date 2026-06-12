export function ThemeScript() {
  const code = `
try {
  var rail = localStorage.getItem('sur9e.hifi.rail') || 'full';
  document.documentElement.dataset.rail = rail;
  var t = localStorage.getItem('sur9e.hifi.t') || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.dataset.theme = 'dark';
} catch {}

/* R-25 — Hydration guard for duplicated tabs.
   Chrome's "Duplicate tab" copies the rendered HTML but the React
   hydration script never fires, leaving the page interactive-dead.
   BFCache restores DO preserve hydration, so the previous unconditional
   pageshow-persisted reload was over-aggressive: it wiped React Query's
   in-memory cache and flashed empty columns on every back/forward nav.
   Now we rely only on the deadline check below to catch the actually-
   broken duplicated-tab case. */
try {
  /* Deadline: if React hasn't claimed .app within 2.5s, force reload.
     Detect hydration by looking for any property starting with __react
     on the .app element — React attaches its fiber there post-mount. */
  var __hydrDeadline = setTimeout(function() {
    var app = document.querySelector('.app');
    if (!app) return;
    var hydrated = false;
    for (var k in app) {
      if (k.charAt(0) === '_' && k.indexOf('__react') === 0) { hydrated = true; break; }
    }
    if (!hydrated) {
      console.warn('[sur9e] React did not hydrate within 2.5s — reloading');
      window.location.reload();
    }
  }, 2500);
  /* Cancel the deadline as soon as ANY user interaction proves the
     page is alive. Clicks, keypresses, and scroll all qualify. */
  function __cancelHydrDeadline() {
    clearTimeout(__hydrDeadline);
    window.removeEventListener('click', __cancelHydrDeadline, true);
    window.removeEventListener('keydown', __cancelHydrDeadline, true);
    window.removeEventListener('scroll', __cancelHydrDeadline, true);
  }
  window.addEventListener('click', __cancelHydrDeadline, true);
  window.addEventListener('keydown', __cancelHydrDeadline, true);
  window.addEventListener('scroll', __cancelHydrDeadline, true);
  /* BFCache restore is the working case: the page was already hydrated
     when it went into the cache. Cancel the deadline immediately so no
     spurious reload kicks in. */
  window.addEventListener('pageshow', function(e) {
    if (e.persisted) __cancelHydrDeadline();
  });
} catch {}
`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

/**
 * Injects the data-rail attribute-selector CSS rules as a raw <style> tag.
 *
 * Turbopack's LightningCSS pipeline silently drops attribute-selector rules
 * whose attribute name doesn't appear in JS content scans (data-rail is only
 * set at runtime via localStorage / JS). Injecting them here bypasses the CSS
 * pipeline entirely, matching what legacy chrome.css does verbatim.
 *
 * Rules are ordered to match chrome.css source order. Media-query overrides
 * are included so tablet/mobile responsive behaviour is also preserved.
 */
export function RailStyles() {
  const css = `
/* ── APP SHELL data-rail (bypassing Turbopack CSS stripping) ── */
.app[data-rail="full"]{grid-template-columns:var(--rail-w-full) 1fr}
:root[data-rail="full"] .app{grid-template-columns:var(--rail-w-full) 1fr}
:root[data-rail="compact"] .app{grid-template-columns:var(--rail-w) 1fr}
html:not(.boot-ready) .app{transition:none}
.app[data-rail="full"] .rail{align-items:stretch;padding:14px 12px}
.app[data-rail="full"] .rail-header{flex-direction:row;justify-content:space-between;align-items:center;padding:0 4px 0 6px;height:48px;margin-bottom:18px;gap:8px}
.app[data-rail="full"] .rail-brand{justify-content:flex-start;flex:1;min-width:0;height:48px}
.app[data-rail="full"] .rail-brand-icon{display:none}
.app[data-rail="full"] .rail-brand-wordmark.light{display:block}
.app[data-rail="full"] .rail-brand-wordmark.dark{display:none}
[data-theme="dark"] .app[data-rail="full"] .rail-brand-wordmark.light{display:none}
[data-theme="dark"] .app[data-rail="full"] .rail-brand-wordmark.dark{display:block}
.app[data-rail="full"] .rail-section-label{display:block}
.app[data-rail="full"] .rail-item{width:100%;justify-content:flex-start;padding:0 10px;gap:12px}
.app[data-rail="full"] .rail-item.active::before{left:-12px}
.app[data-rail="full"] .rail-item svg.rail-icon,.app[data-rail="full"] .rail-item>svg{width:18px;height:18px}
.app[data-rail="full"] .rail-label{display:inline}
.app[data-rail="full"] .rail-badge{position:static;margin-left:auto;height:18px;min-width:22px;padding:0 6px;font-size:11px;background:var(--surface-2);color:var(--text-3)}
.app[data-rail="full"] .rail-badge.accent{background:var(--accent-cta);color:#fff}
.app[data-rail="full"] .rail-tooltip{display:none}
/* Theme switch orientation — horizontal in the full rail (base), a vertical
   icon column in the compact rail (and ≤1024px where full is forced compact).
   Scoped to .rail so the Settings page's mobile theme row stays horizontal. */
.app[data-rail="compact"] .rail .theme-switch,:root[data-rail="compact"] .app .rail .theme-switch{flex-direction:column}
.app[data-rail="full"] .rail-theme{justify-content:flex-start;padding:0 10px}
.app[data-rail="full"] .rail-toggle svg{transform:rotate(0deg)}
.app[data-rail="compact"] .rail-toggle svg{transform:rotate(180deg)}
.app[data-rail="compact"] .rail-toggle{width:32px;height:26px;border-radius:var(--radius-sm)}
@media(max-width:1024px){
  .app,.app[data-rail="full"],.app[data-rail="compact"],:root[data-rail="full"] .app,:root[data-rail="compact"] .app{grid-template-columns:var(--rail-w) 1fr}
  .app[data-rail="full"] .rail{align-items:center;padding:14px 0}
  .app[data-rail="full"] .rail-label{display:none}
  .app[data-rail="full"] .rail-section-label{display:none}
  .app[data-rail="full"] .rail-brand-wordmark.light,.app[data-rail="full"] .rail-brand-wordmark.dark,[data-theme="dark"] .app[data-rail="full"] .rail-brand-wordmark.light,[data-theme="dark"] .app[data-rail="full"] .rail-brand-wordmark.dark{display:none}
  .app[data-rail="full"] .rail-brand-icon{display:block}
  .app[data-rail="full"] .rail-brand{justify-content:center;flex:none;height:auto}
  .app[data-rail="full"] .rail-item{width:40px;justify-content:center;padding:0;gap:0}
  .app[data-rail="full"] .rail-item.active::before{left:-14px}
  .app[data-rail="full"] .rail-item svg.rail-icon,.app[data-rail="full"] .rail-item>svg{width:22px;height:22px}
  .app[data-rail="full"] .rail-badge{position:absolute;top:4px;right:4px;min-width:14px;height:14px;padding:0 3px;margin-left:0;font-size:10px;background:var(--accent-cta);color:#fff}
  .app[data-rail="full"] .rail-tooltip{display:block}
  .app[data-rail="full"] .rail .theme-switch{flex-direction:column}
  .app[data-rail="full"] .rail-theme{justify-content:center;padding:0}
}
@media(max-width:640px){
  .app,.app[data-rail="full"],.app[data-rail="compact"],:root[data-rail="full"] .app,:root[data-rail="compact"] .app{grid-template-columns:1fr}
}
`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
