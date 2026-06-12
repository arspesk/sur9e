'use client';

import { useEffect } from 'react';
import { loadSettingsAction } from '@/server/actions/settings';

export function ChromeEffects() {
  useEffect(() => {
    const THEME_KEY = 'sur9e.hifi.t';
    const _systemMQ = window.matchMedia('(prefers-color-scheme: dark)');

    function _applyResolvedTheme(t: string) {
      const resolved = t === 'system' ? (_systemMQ.matches ? 'dark' : 'light') : t;
      if (resolved === 'dark') document.documentElement.dataset.theme = 'dark';
      else delete document.documentElement.dataset.theme;
    }

    function onSystemMQChange() {
      if (localStorage.getItem(THEME_KEY) === 'system') _applyResolvedTheme('system');
    }
    _systemMQ.addEventListener('change', onSystemMQChange);

    // Expose setTheme globally for settings page
    (window as any).setTheme = function (t: string) {
      if (!['light', 'dark', 'system'].includes(t)) t = 'light';
      _applyResolvedTheme(t);
      localStorage.setItem(THEME_KEY, t);
    };

    async function bootstrapTheme() {
      let theme: string | null = localStorage.getItem(THEME_KEY);
      if (!theme) {
        try {
          const s = await loadSettingsAction();
          theme = s?.appearance?.theme || 'system';
          localStorage.setItem(THEME_KEY, theme);
        } catch {
          theme = 'system';
        }
      }
      _applyResolvedTheme(theme ?? 'system');
    }
    bootstrapTheme();

    // Mark boot complete so transitions re-engage for runtime toggles
    requestAnimationFrame(() => document.documentElement.classList.add('boot-ready'));

    return () => {
      _systemMQ.removeEventListener('change', onSystemMQChange);
    };
  }, []);

  return null;
}
