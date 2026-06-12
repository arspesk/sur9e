// Shared HTML escaper — the single implementation for every surface that
// builds markup strings (report inline markdown, marked renderer override,
// editor attribute serialization). One entity table so escaping coverage
// can't silently diverge between call sites.
//
// Framework-free and browser-safe (no React/Node imports).

export function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
