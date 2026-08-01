/**
 * fetchJson — JSON fetch with structured error extraction.
 *
 * Throws Error(msg) where msg is `body.error` if the response is JSON
 * with that field, otherwise the raw body text, otherwise the status
 * line. The four legacy /api routes use `{ "error": "..." }` envelopes,
 * so this preserves their messages instead of surfacing a bare 500.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    let msg = body;
    try {
      msg = JSON.parse(body)?.error ?? body;
    } catch {
      // body wasn't JSON — fall back to raw text
    }
    throw new Error(msg || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
