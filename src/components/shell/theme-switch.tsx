'use client';

// components/shell/theme-switch.tsx — Sun/Moon/Monitor segmented control.
//
// Replaces the old Settings → Appearance section (sections/ui-section.tsx).
// Lives in the shell (rail + mobile settings row), OUTSIDE the settings rhf
// form, so it owns the full theme side-effect chain itself:
//   1. applyTheme(): localStorage `sur9e.hifi.t` + <html data-theme> — same
//      keys the boot ThemeScript and chrome-effects.tsx read, so first-paint
//      behavior is unchanged.
//   2. window.setTheme mirror (chrome-effects.tsx installs it; it re-resolves
//      "system" against prefers-color-scheme and keeps the MQ listener state
//      coherent).
//   3. saveSettingsAction({ appearance: { theme } }) — persists the
//      cross-browser default to config.yml via the same deep-merging save
//      path the settings form uses. The settings form no longer sends
//      `appearance` at all (sanitizeForSave strips it), so the two writers
//      can't clobber each other.
//
// The current value is client-only (localStorage); state starts null and is
// read in an effect, so SSR + first client render match (no hydration
// mismatch) — until mount no option is marked checked.

import { Monitor, Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { saveSettingsAction } from '@/server/actions/settings';

const THEME_KEY = 'sur9e.hifi.t';

const OPTIONS = ['light', 'dark', 'system'] as const;
type Theme = (typeof OPTIONS)[number];

const THEME_LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const THEME_ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

// Same resolution the old ui-section used: "system" resolves against the
// OS preference; dark sets <html data-theme="dark">, anything else clears it.
function applyTheme(theme: Theme) {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  if (resolved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* no-op */
  }
}

interface ThemeSwitchProps {
  className?: string;
  /** Render .rail-tooltip flyouts (compact-rail affordance). The mobile
   *  settings row passes false and relies on title + aria-label. */
  withTooltips?: boolean;
}

export function ThemeSwitch({ className, withTooltips = false }: ThemeSwitchProps) {
  // null until mounted — localStorage is client-only.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      /* no-op */
    }
    setTheme(OPTIONS.includes(saved as Theme) ? (saved as Theme) : 'system');
  }, []);

  const select = useCallback((next: Theme) => {
    setTheme(next);
    applyTheme(next);
    const w = window as unknown as { setTheme?: (t: string) => void };
    if (typeof w.setTheme === 'function') w.setTheme(next);
    // Persist the cross-browser default. Fire-and-forget: the local apply
    // already happened, and a failed write only affects NEW browser sessions.
    saveSettingsAction({ appearance: { theme: next } }).catch((err: unknown) => {
      console.error('[theme] failed to persist appearance.theme', err);
    });
  }, []);

  // Roving radiogroup keyboard support (same as the old #themeRow control).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const current = theme ?? 'system';
      const idx = OPTIONS.indexOf(current);
      let next: Theme | null = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        next = OPTIONS[(idx + 1) % OPTIONS.length]!;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        next = OPTIONS[(idx - 1 + OPTIONS.length) % OPTIONS.length]!;
      }
      if (next) {
        e.preventDefault();
        select(next);
        const group = e.currentTarget;
        const btn = group.querySelector<HTMLElement>(`[data-theme-option="${next}"]`);
        btn?.focus();
      }
    },
    [theme, select],
  );

  return (
    <div
      className={className ? `theme-switch ${className}` : 'theme-switch'}
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={handleKeyDown}
    >
      {OPTIONS.map((t, i) => {
        const Icon = THEME_ICONS[t];
        const active = theme === t;
        return (
          <button
            key={t}
            type="button"
            className={active ? 'theme-switch__btn is-active' : 'theme-switch__btn'}
            data-theme-option={t}
            role="radio"
            aria-checked={active}
            aria-label={`${THEME_LABELS[t]} theme`}
            title={`${THEME_LABELS[t]} theme`}
            // Before mount no option is active — make the first button the
            // tab stop so the group stays keyboard-reachable.
            tabIndex={active || (theme === null && i === 0) ? 0 : -1}
            onClick={() => select(t)}
          >
            <Icon aria-hidden="true" strokeWidth={1.6} />
            {withTooltips && <span className="rail-tooltip">{THEME_LABELS[t]}</span>}
          </button>
        );
      })}
    </div>
  );
}
