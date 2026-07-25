'use client';

import {
  Briefcase,
  ChevronLeft,
  House,
  LineChart,
  MessageSquare,
  Settings,
  User,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ThemeSwitch } from './theme-switch';

// Routes that should anchor to the Offers rail item. Reports are reached from
// the offers list, and the table/pipeline/kanban views are all offers surfaces.
// Kept consistent with mobile-nav.tsx's Offers `activeOn` set.
const OFFERS_PREFIXES = ['/offers', '/report', '/pipeline', '/table'];

/** Pinned-state key — unchanged: ThemeScript reads it pre-paint. */
const RAIL_KEY = 'sur9e.hifi.rail';

/** Hover-peek is desktop-only. At ≤1024px the rail is force-collapsed to
 *  icon-only and at ≤640px MobileNav takes over entirely, so an expanding
 *  overlay would fight both. Mirrors the `@media (min-width: 1025px)` gate
 *  wrapped around the peek CSS in chrome.css / RailStyles. */
const PEEK_MQ = '(min-width: 1025px)';

/** Grace period before an un-hovered, un-focused rail collapses again, so
 *  crossing the gap between rail items (or between the rail and the edge
 *  disc, which overhangs the boundary) never flickers the overlay. */
const PEEK_LEAVE_MS = 150;

type RailMode = 'full' | 'compact';

function isOffersActive(pathname: string): boolean {
  return OFFERS_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

/** Mirror the pinned state to BOTH carriers. `.app` scopes every rail CSS
 *  rule; `<html>` is what ThemeScript reads pre-paint on the next load, so
 *  neither may be dropped. */
function mirrorRail(mode: RailMode) {
  const app = document.querySelector('.app') as HTMLElement | null;
  if (app) app.dataset.rail = mode;
  document.documentElement.dataset.rail = mode;
}

function persistRail(mode: RailMode) {
  try {
    localStorage.setItem(RAIL_KEY, mode);
  } catch {
    /* private mode / storage disabled — the in-memory state still applies */
  }
}

export function RailNav() {
  const pathname = usePathname();
  const offersActive = isOffersActive(pathname);
  const chatActive = pathname === '/chat' || pathname.startsWith('/chat/');

  // Pinned state. `null` until the boot effect reads the persisted value —
  // the server renders `.app[data-rail="full"]`, so the pre-mount render must
  // present as expanded to avoid a hydration mismatch.
  const [rail, setRail] = useState<RailMode | null>(null);
  const [peek, setPeek] = useState(false);
  const pinned = rail !== 'compact';
  // Same value as `rail`, readable synchronously. The DOM guard below runs
  // from a MutationObserver callback, which can fire before React has
  // committed the state update that caused the mutation.
  const modeRef = useRef<RailMode | null>(null);

  // Hover and focus are tracked separately: either one alone keeps the peek
  // open, so leaving with the mouse while focus is still inside must not
  // collapse it (and vice versa).
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  // Set when the user collapses the rail with the disc. The disc sits ON the
  // rail, so pointer/focus are still inside it at that moment; without this
  // latch the rail would instantly re-open as a peek overlay and the click
  // would read as a no-op. Cleared as soon as pointer/focus actually leave.
  const suppressRef = useRef(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openPeek = () => {
    cancelClose();
    if (suppressRef.current) return;
    // Only the unpinned rail peeks — pinned is already at full width.
    if (rail !== 'compact') return;
    if (!window.matchMedia(PEEK_MQ).matches) return;
    setPeek(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      if (!hoverRef.current && !focusRef.current) setPeek(false);
    }, PEEK_LEAVE_MS);
  };

  const closePeekNow = () => {
    cancelClose();
    hoverRef.current = false;
    focusRef.current = false;
    setPeek(false);
  };

  // Boot: adopt the persisted pinned state, mirror it to both carriers, then
  // mark boot complete in a rAF so the width/scrim transitions only engage
  // for runtime toggles (see `html:not(.boot-ready)` in chrome.css).
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(RAIL_KEY);
    } catch {
      /* no-op */
    }
    const initial: RailMode =
      (document.documentElement.dataset.rail || saved) === 'compact' ? 'compact' : 'full';
    modeRef.current = initial;
    mirrorRail(initial);
    setRail(initial);
    requestAnimationFrame(() => document.documentElement.classList.add('boot-ready'));
  }, []);

  // Guard: layout.tsx renders `.app` with a hardcoded data-rail="full" so the
  // labels are right pre-hydration. React skips the DOM write while that prop
  // is unchanged between renders (verified: a settings save + revalidatePath
  // produces zero writes to the attribute), but a REMOUNT of the shell would
  // re-assert the literal and silently expand a collapsed rail. Re-assert the
  // value we own whenever anything else writes a different one. `<html>` is
  // outside React entirely and needs no guard.
  useEffect(() => {
    const app = document.querySelector('.app') as HTMLElement | null;
    if (!app) return;
    const obs = new MutationObserver(() => {
      const want = modeRef.current;
      if (want && app.dataset.rail !== want) app.dataset.rail = want;
    });
    obs.observe(app, { attributes: true, attributeFilter: ['data-rail'] });
    return () => obs.disconnect();
  }, []);

  // `.app` lives outside this component's tree (layout.tsx), so the peek flag
  // is written imperatively — same pattern as data-rail.
  useEffect(() => {
    const app = document.querySelector('.app') as HTMLElement | null;
    if (!app) return;
    if (peek) app.dataset.railPeek = 'true';
    else delete app.dataset.railPeek;
    return () => {
      delete app.dataset.railPeek;
    };
  }, [peek]);

  // While peeking: Escape collapses, and so does dropping below the desktop
  // breakpoint (where the rail is force-collapsed and the peek CSS is gated
  // out — leaving the attribute set would be dead state).
  useEffect(() => {
    if (!peek) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePeekNow();
    };
    const mq = window.matchMedia(PEEK_MQ);
    const onMqChange = () => {
      if (!mq.matches) closePeekNow();
    };
    window.addEventListener('keydown', onKeyDown);
    mq.addEventListener('change', onMqChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      mq.removeEventListener('change', onMqChange);
    };
  }, [peek]);

  useEffect(() => cancelClose, []);

  const togglePinned = () => {
    const next: RailMode = rail === 'full' ? 'compact' : 'full';
    // Ref first: the MutationObserver guard fires on the very next write.
    modeRef.current = next;
    mirrorRail(next);
    persistRail(next);
    setRail(next);
    // Collapse any live peek and hold it shut until the pointer/focus leaves.
    cancelClose();
    setPeek(false);
    suppressRef.current = true;
  };

  return (
    <>
      {/* In-flow gutter — the ONLY thing that reserves horizontal space for
          the rail. The rail itself is position:fixed on top of it, so the
          hover-peek overlay can animate its width without ever changing
          .main's width (see chrome.css: the 45s /offers freeze). */}
      <div className="rail-gutter" aria-hidden="true" />

      <aside
        id="workspaceRail"
        className="rail"
        aria-label="Workspace navigation"
        onMouseEnter={() => {
          hoverRef.current = true;
          openPeek();
        }}
        onMouseLeave={() => {
          hoverRef.current = false;
          suppressRef.current = false;
          scheduleClose();
        }}
        // React's onFocus/onBlur are focusin/focusout (they bubble), so these
        // cover every control in the rail — keyboard users get the same peek.
        //
        // KEYBOARD focus only, via :focus-visible. A mouse click also focuses
        // the control it hits, and a click leaves that focus behind: without
        // this gate, clicking anything in the rail (the theme switch is the
        // easy repro) latched the peek open forever — the pointer could leave
        // but focus never did, so the rail never collapsed and read as
        // "the rail reset itself".
        onFocus={e => {
          const viaKeyboard = e.target instanceof Element && e.target.matches(':focus-visible');
          focusRef.current = viaKeyboard;
          if (viaKeyboard) openPeek();
          else if (!hoverRef.current) scheduleClose();
        }}
        onBlur={e => {
          // Focus moving between two rail controls must not close it.
          if (e.currentTarget.contains(e.relatedTarget)) return;
          focusRef.current = false;
          suppressRef.current = false;
          scheduleClose();
        }}
      >
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
        </div>

        {/* Edge disc — pins / unpins the rail. Absolutely positioned against
            .rail so it straddles the right edge and rides it as the rail
            widens. Visible in both states; the chevron points the way the
            rail will move. */}
        <button
          className="rail-toggle"
          type="button"
          aria-label={pinned ? 'Collapse navigation rail' : 'Expand navigation rail'}
          aria-expanded={pinned}
          aria-controls="workspaceRail"
          title={pinned ? 'Collapse navigation rail' : 'Expand navigation rail'}
          onClick={togglePinned}
        >
          <ChevronLeft aria-hidden="true" />
        </button>

        {/* Section labels double as the collapsed rail's group separators:
            the text is visually hidden and a hairline is drawn in its place
            (chrome.css .rail-section-label::before). The text stays in the
            a11y tree in BOTH states — hence the nested span rather than a
            font-size/color trick. */}
        <div className="rail-section-label">
          <span className="rail-section-label__text">Workspace</span>
        </div>
        <Link
          href="/"
          className={pathname === '/' ? 'rail-item active' : 'rail-item'}
          title="Home"
          aria-current={pathname === '/' ? 'page' : undefined}
        >
          <House aria-hidden="true" className="rail-icon" strokeWidth={1.6} />
          <span className="rail-label">Home</span>
          <span className="rail-tooltip">Home</span>
        </Link>
        <Link
          href="/chat"
          className={chatActive ? 'rail-item active' : 'rail-item'}
          title="Chat"
          aria-current={chatActive ? 'page' : undefined}
        >
          <MessageSquare aria-hidden="true" className="rail-icon" strokeWidth={1.6} />
          <span className="rail-label">Chat</span>
          <span className="rail-tooltip">Chat</span>
        </Link>
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

        <div className="rail-section-label">
          <span className="rail-section-label__text">Settings</span>
        </div>
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

      {/* Peek scrim — dims the page behind the overlay and collapses it on
          click. Inert (opacity 0 + pointer-events none) unless peeking, so it
          can never swallow a click on the content. */}
      <div className="rail-scrim" aria-hidden="true" onClick={closePeekNow} />
    </>
  );
}
