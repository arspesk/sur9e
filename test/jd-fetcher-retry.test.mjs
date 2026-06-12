// Regression: transient JD-fetch failures (aborts, 429/5xx) get exactly one
// retry; dead pages (404) don't. 48/302 offers in the 2026-06-05 scheduled
// scan were discarded on one-off aborts a single retry would have saved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJobDescription } from '../batch/jd-fetcher.mjs';

const JD_HTML = `<html><body><main>${'Real job description text. '.repeat(60)}</main></body></html>`;
const noSleep = () => Promise.resolve();

afterEach(() => vi.unstubAllGlobals());

describe('fetchJobDescription retry', () => {
  it('retries once after an abort and returns the successful second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('This operation was aborted'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JD_HTML,
      });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchJobDescription('https://example.com/jobs/1', { sleep: noSleep });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('ok');
    expect(res.text).toContain('Real job description text.');
  });

  it('does NOT retry a 404 — genuinely dead page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchJobDescription('https://example.com/jobs/gone', { sleep: noSleep });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/HTTP 404/);
  });

  it('retries a 503 and reports both errors when the retry also fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchJobDescription('https://example.com/jobs/2', { sleep: noSleep });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/after retry/);
  });

  it('does not retry an invalid URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchJobDescription('not a url', { sleep: noSleep });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.error).toBe('invalid URL');
  });
});
