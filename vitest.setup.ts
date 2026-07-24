import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement Element.prototype.scrollIntoView, so any component or
// hook that calls it (e.g. useActiveOptionScroll keeping the active listbox
// option in view during arrow-key nav) throws under test. Polyfill it as a
// no-op — the browser provides the real behavior; tests only need it not to
// throw. Tests that want to assert the call can vi.spyOn it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
