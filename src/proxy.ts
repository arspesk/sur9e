// Future home for auth gating, A/B routing, feature flag cookies, geo
// redirects, and rate limiting. Today: no-op pass-through.
//
// File + function renamed from middleware → proxy per Next 16 convention.
// Matcher covers every app route except Next.js internals and static
// assets; adjust when the first real proxy logic lands.

import { type NextRequest, NextResponse } from 'next/server';

export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
