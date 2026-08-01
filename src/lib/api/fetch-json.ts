/**
 * fetchJson — JSON fetch with structured error extraction.
 *
 * Throws FetchJsonError(status, msg) where msg is `body.error` if the
 * response is JSON with that field, otherwise the raw body text, otherwise
 * the status line. Callers can use the status without parsing the message.
 */
export class FetchJsonError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'FetchJsonError';
    this.status = status;
  }
}

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
    throw new FetchJsonError(response.status, msg || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
