import type { Route } from 'next';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

export interface Crumb {
  label: string;
  // Optional typed route (C2.4 typedRoutes). When omitted the crumb renders
  // as plain text — the active page in the trail.
  href?: Route;
}

interface TopbarProps {
  crumbs?: Crumb[];
  children?: ReactNode;
}

export function Topbar({ crumbs = [], children }: TopbarProps) {
  return (
    <header className="topbar">
      {/* `nav` with `aria-label` is the semantic breadcrumb landmark; the
          `.crumbs` class is kept on the same element so the existing
          `.topbar > .crumbs` and related selectors still match. Wrapping
          the div in another nav broke .topbar's direct-child flex layout. */}
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {c.href ? (
              <Link href={c.href} className="crumb-link">
                {c.label}
              </Link>
            ) : (
              <span className="here">{c.label}</span>
            )}
            {i < crumbs.length - 1 && (
              <span className="sep" aria-hidden="true">
                /
              </span>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="topbar-actions">{children}</div>
    </header>
  );
}
