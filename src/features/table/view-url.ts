// Helpers for the /offers route view-switcher. Both <TablePage> and
// <PipelinePage> mount under /offers and need to build hrefs that preserve
// the current filter query while swapping the `view` param.

type ReadonlyParams = Pick<URLSearchParams, 'toString'> & { get: (key: string) => string | null };

/**
 * Drop the `view` param from the current query, returning the rest as a
 * URL-encoded query string (without leading `?`). Used by the Table-side
 * switcher link, where `view` is implicit (the default).
 */
export function stripView(params: ReadonlyParams): string {
  const out = new URLSearchParams(params.toString());
  out.delete('view');
  return out.toString();
}

/**
 * Replace the `view` param with the given value, preserving every other
 * param. Returns a URL-encoded query string (without leading `?`).
 */
export function withView(params: ReadonlyParams, view: 'table' | 'kanban'): string {
  const out = new URLSearchParams(params.toString());
  out.set('view', view);
  return out.toString();
}
