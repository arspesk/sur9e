'use client';

import { Briefcase, ChevronLeft, LineChart, Settings, User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { ThemeSwitch } from './theme-switch';

// Routes that should anchor to the Offers rail item. Reports are reached from
// the offers list, and the table/pipeline/kanban views are all offers surfaces.
// Kept consistent with mobile-nav.tsx's Offers `activeOn` set.
const OFFERS_PREFIXES = ['/offers', '/report', '/pipeline', '/table'];

function isOffersActive(pathname: string): boolean {
  return OFFERS_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

export function RailNav() {
  const pathname = usePathname();
  const offersActive = isOffersActive(pathname);

  useEffect(() => {
    const app = document.querySelector('.app') as HTMLElement | null;
    const railBtn = document.getElementById('railToggle');
    // Mark boot complete so transitions can re-engage for runtime toggles.
    // Moved ABOVE the early-return path that the railBtn listener cleanup
    // used to short-circuit — `boot-ready` is unconditional now.
    requestAnimationFrame(() => document.documentElement.classList.add('boot-ready'));
    if (app) {
      const RAIL_KEY = 'sur9e.hifi.rail';
      const saved =
        document.documentElement.dataset.rail || localStorage.getItem(RAIL_KEY) || 'full';
      app.dataset.rail = saved;
      if (railBtn) {
        const handleToggle = () => {
          const next = app.dataset.rail === 'full' ? 'compact' : 'full';
          app.dataset.rail = next;
          document.documentElement.dataset.rail = next;
          localStorage.setItem(RAIL_KEY, next);
        };
        railBtn.addEventListener('click', handleToggle);
        return () => railBtn.removeEventListener('click', handleToggle);
      }
    }
  }, []);

  return (
    <aside className="rail" aria-label="Workspace navigation">
      <div className="rail-header">
        <a href="/" className="rail-brand" aria-label="sur9e workspace home">
          <Image
            className="rail-brand-icon"
            src="/assets/icon-logo.svg"
            alt=""
            width={28}
            height={28}
          />
          <Image
            className="rail-brand-wordmark light"
            src="/assets/sur9e-wordmark-black.svg"
            alt=""
            width={136}
            height={30}
            // Above-the-fold LCP candidate: the offers table hydrates behind a
            // skeleton, so the rail wordmark is the leading LCP at first paint.
            // `priority` -> loading="eager" + fetchpriority=high + preload link.
            // Only the default (light) wordmark gets it; the dark variant is
            // display:none in the light theme, so priority-loading it would
            // preload an unused asset.
            priority
          />
          <Image
            className="rail-brand-wordmark dark"
            src="/assets/sur9e-wordmark-white.svg"
            alt=""
            width={136}
            height={30}
          />
        </a>
        <button
          className="rail-toggle"
          id="railToggle"
          type="button"
          aria-label="Toggle menu"
          title="Toggle menu"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
      </div>

      <div className="rail-section-label">Workspace</div>
      <Link
        href="/offers"
        className={offersActive ? 'rail-item active' : 'rail-item'}
        title="Offers"
        aria-current={offersActive ? 'page' : undefined}
      >
        <Briefcase aria-hidden="true" className="rail-icon" strokeWidth={1.6} />
        <span className="rail-label">Offers</span>
        <span className="rail-tooltip">Offers</span>
      </Link>
      <Link
        href="/analytics"
        className={pathname === '/analytics' ? 'rail-item active' : 'rail-item'}
        title="Analytics"
        aria-current={pathname === '/analytics' ? 'page' : undefined}
      >
        <LineChart aria-hidden="true" className="rail-icon" strokeWidth={1.6} />
        <span className="rail-label">Analytics</span>
        <span className="rail-tooltip">Analytics</span>
      </Link>

      <span className="rail-spacer"></span>

      {/* Theme switcher — was Settings → Appearance; per-browser preference
          plus config.yml default, owned by ThemeSwitch itself. */}
      <div className="rail-theme">
        <ThemeSwitch withTooltips />
      </div>

      <div className="rail-section-label">Settings</div>
      <Link
        href="/profile"
        className={pathname === '/profile' ? 'rail-item active' : 'rail-item'}
        title="Profile"
        aria-current={pathname === '/profile' ? 'page' : undefined}
      >
        <User aria-hidden="true" className="rail-icon" strokeWidth={1.6} />
        <span className="rail-label">Profile</span>
        <span className="rail-tooltip">Profile</span>
      </Link>
      <Link
        href="/settings"
        className={pathname === '/settings' ? 'rail-item active' : 'rail-item'}
        title="Settings"
        aria-current={pathname === '/settings' ? 'page' : undefined}
      >
        <Settings aria-hidden="true" className="rail-icon" strokeWidth={1.6} />
        <span className="rail-label">Settings</span>
        <span className="rail-tooltip">Settings</span>
      </Link>
    </aside>
  );
}
