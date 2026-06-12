// Type-safe wrapper around Next's `revalidatePath`. The built-in
// accepts `string`, so a typo like `revalidatePath('/tabel')`
// typechecks but silently no-ops at runtime. This wrapper forces
// callers through the typedRoutes gate; route literals not in
// `Route<T>` or `DynamicRoutePattern` fail at typecheck.

import type { Route } from 'next';
import { revalidatePath as nextRevalidatePath, revalidateTag } from 'next/cache';

/**
 * Patterns for dynamic page routes that server actions revalidate.
 *
 * `Route<T>` resolves concrete URLs (e.g. `/report/foo`) but not the
 * bracketed pattern Next expects when revalidating a whole dynamic
 * segment. Keep this in sync with `src/app/**\/[*]/page.tsx`.
 */
type DynamicRoutePattern = '/report/[filename]';

/**
 * Type-safe wrapper around Next's `revalidatePath`.
 *
 * Accepts:
 * - a typed route literal (static or resolved dynamic URL) from `Route<T>`
 * - a known dynamic-segment pattern from `DynamicRoutePattern`
 *
 * For dynamic-segment routes, pass the pattern (`'/report/[filename]'`)
 * plus `'page'` as the type — matches Next's underlying API.
 */
export function revalidatePath<T extends string>(
  path: Route<T> | DynamicRoutePattern,
  type?: 'layout' | 'page',
): void {
  nextRevalidatePath(path as string, type);
}

export { revalidateTag };
