// SPDX-License-Identifier: MIT
// batch/jd-fetcher.mjs
//
// Fetch a job-description URL and return plain text suitable for inlining
// into a screener prompt. Provider-agnostic: replaces each LLM
// integration's bespoke web-fetch tool so screen.mjs can work with any
// provider (Claude / Codex / OpenCode), not just the
// Claude WebFetch tool.
//
// Strategy:
//   1. fetch() the URL with a desktop UA + 15s timeout
//   2. Strip <script>, <style>, <noscript> blocks entirely
//   3. Convert remaining tags to whitespace, collapse runs
//   4. Decode common HTML entities
//   5. Truncate to MAX_CHARS so prompt token budget stays predictable
//
// What this DOESN'T do:
//   - Render JavaScript SPAs (LinkedIn JD body is JS-mounted; the static
//     HTML returns a generic shell). For auth-walled / SPA pages we emit
//     whatever we got + a `__JD_INCOMPLETE__` marker so the screen
//     prompt can flag the result as low-confidence.
//   - Follow paywalls / consent walls. Same handling.
//
// Returns: { text: string, status: 'ok' | 'incomplete' | 'error',
//            httpStatus: number | null, error?: string }

const FETCH_TIMEOUT_MS = 15_000;
// ~5K tokens of JD body — fits comfortably in any provider's context. Sized
// from an 18-posting survey of clean container-extracted JDs (median 5.8K,
// p90 9.4K, max 11.9K chars): the old 12K cap left <1% headroom on the
// longest real posting, and US postings put the salary disclosure at the
// BOTTOM — a clipped tail eats exactly what the compensation axis needs.
const MAX_CHARS = 20_000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const SPA_HOSTS = ['www.linkedin.com', 'linkedin.com']; // JD lives in a known container (see extractLinkedInJd)

// LinkedIn guest job pages server-render the JD inside
// <div class="show-more-less-html__markup ...">. Extract that container's
// text by walking <div> nesting depth from its opening tag — when present,
// the fetch is a real read (status 'ok'), not an SPA shell. Pure + exported
// for unit tests. Returns null when the container is absent (logged-out
// wall / genuine shell) so the caller can flag `incomplete` honestly.
export function extractLinkedInJd(html) {
  const s = String(html || '');
  const idx = s.indexOf('show-more-less-html__markup');
  if (idx === -1) return null;
  const start = s.lastIndexOf('<div', idx);
  if (start === -1) return null;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    depth += m[0] === '<div' ? 1 : -1;
    if (depth === 0) {
      const text = stripHtml(s.slice(start, m.index));
      return text || null;
    }
  }
  return null; // unbalanced markup — treat as unreadable
}

// The posting's title / company / location live in the guest page's top-card,
// OUTSIDE the JD container — and the JD prose frequently never states them.
// Without this header the model either leaves location blank or, worse,
// absorbs LinkedIn's geo-targeted page chrome ("Los Angeles, CA Expand
// search" is injected per the fetching IP's city) and labels remote roles as
// local/hybrid for whatever city the server happens to sit in (2026-06-06:
// 51 remote roles stamped "Los Angeles, CA" this way). Pure + exported for
// unit tests; every field is null when its markup is absent.
export function extractLinkedInTopCard(html) {
  const s = String(html || '');
  const grab = re => {
    const m = s.match(re);
    if (!m) return null;
    const text = stripHtml(m[1]).trim();
    return text || null;
  };
  return {
    title: grab(/<h1[^>]*\btopcard__title[^>]*>([\s\S]*?)<\/h1>/),
    company: grab(/<a[^>]*\btopcard__org-name-link[^>]*>([\s\S]*?)<\/a>/),
    location: grab(/<span[^>]*\btopcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/),
  };
}

// Ashby (jobs.ashbyhq.com/<org>/<job-uuid>) serves a React SPA shell — the
// static HTML carries no JD body. But Ashby exposes a public no-auth
// posting API that returns every listed job with a plain-text description:
//   https://api.ashbyhq.com/posting-api/job-board/<org>
// Match the URL shape, look the job up by UUID, and return its
// descriptionPlain directly. A delisted/unknown UUID falls through to the
// generic HTML path (which yields `incomplete` — honest "can't read it").
const ASHBY_URL_RE =
  /^https?:\/\/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

async function fetchAshbyPosting(org, jobId, signal) {
  const res = await fetch(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`,
    { signal, headers: { 'User-Agent': UA, Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const job = Array.isArray(data?.jobs)
    ? data.jobs.find(j => String(j.id).toLowerCase() === jobId.toLowerCase())
    : null;
  if (!job) return null;
  const description = String(job.descriptionPlain || stripHtml(job.descriptionHtml || ''));
  if (!description.trim()) return null;
  const header = [
    `Title: ${job.title ?? ''}`,
    `Location: ${job.location ?? ''}${job.isRemote ? ' (Remote)' : ''}`,
    job.workplaceType ? `Workplace: ${job.workplaceType}` : '',
    job.employmentType ? `Employment: ${job.employmentType}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `${header}\n\n${description}`;
}

function stripHtml(html) {
  let s = String(html || '');
  // Remove entire script/style/noscript blocks (including contents).
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  // Convert remaining tags to spaces.
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode the handful of HTML entities that show up routinely in JD bodies.
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
  // Numeric entities (e.g. &#8217;) → corresponding char.
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Collapse whitespace runs.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { text: '', status: 'error', httpStatus: null, error: 'invalid URL' };
  }
  try {
    // Ashby SPA → public posting API (full plain-text JD). Falls through to
    // the generic HTML path when the org/job isn't served by the API.
    const ashby = url.match(ASHBY_URL_RE);
    if (ashby) {
      try {
        const text = await fetchAshbyPosting(ashby[1], ashby[2], controller.signal);
        if (text) {
          return { text: text.slice(0, MAX_CHARS), status: 'ok', httpStatus: 200 };
        }
      } catch {
        // API hiccup — fall through to the generic fetch below.
      }
    }
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'follow',
    });
    const httpStatus = res.status;
    if (!res.ok) {
      return {
        text: '',
        status: 'error',
        httpStatus,
        error: `HTTP ${httpStatus} ${res.statusText}`,
      };
    }
    const html = await res.text();
    const isSpa = SPA_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
    if (isSpa) {
      // LinkedIn: only the JD container counts. Whole-page text is dominated
      // by nav/suggested-jobs boilerplate, so the generic 800-char floor
      // can't tell a real read from a shell — container presence can.
      // (2026-06-06: the previous unconditional `incomplete` here made the
      // screen prompt stamp ~97% of scanned offers low_confidence.)
      const jd = extractLinkedInJd(html);
      if (jd && jd.length >= 200) {
        // Prepend the top-card metadata: the posting's own location is
        // authoritative and usually absent from the JD prose.
        const tc = extractLinkedInTopCard(html);
        const header = [
          tc.title ? `Title: ${tc.title}` : '',
          tc.company ? `Company: ${tc.company}` : '',
          tc.location ? `Location (from the posting page header): ${tc.location}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        const text = header ? `${header}\n\n${jd}` : jd;
        return { text: text.slice(0, MAX_CHARS), status: 'ok', httpStatus };
      }
      return { text: stripHtml(html).slice(0, MAX_CHARS), status: 'incomplete', httpStatus };
    }
    const text = stripHtml(html).slice(0, MAX_CHARS);
    // JD body usually has >800 chars after stripping. If we got less, the
    // page was probably an SPA shell, a consent wall, or a 200-OK error
    // page. Flag as incomplete so the prompt knows to score low_confidence.
    if (text.length < 800) {
      return { text, status: 'incomplete', httpStatus };
    }
    return { text, status: 'ok', httpStatus };
  } catch (err) {
    return {
      text: '',
      status: 'error',
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

const RETRY_BACKOFF_MS = 2_000;

/** Transient failures (worth one retry): network-level errors — timeouts,
 *  aborts, DNS/TLS hiccups (httpStatus null) — and rate-limit/server
 *  errors (429/5xx). NOT retried: invalid URLs and 4xx like 404/410,
 *  which are genuinely dead pages. Under a 20-worker screen run, 16% of
 *  fetches died as one-off aborts that a single retry would have saved. */
function isTransient(result) {
  if (result.status !== 'error') return false;
  if (result.error === 'invalid URL') return false;
  if (result.httpStatus == null) return true;
  return result.httpStatus === 429 || result.httpStatus >= 500;
}

export async function fetchJobDescription(url, { sleep } = {}) {
  const wait = sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  const first = await fetchOnce(url);
  if (!isTransient(first)) return first;
  await wait(RETRY_BACKOFF_MS);
  const second = await fetchOnce(url);
  // Surface that a retry happened so the screen log tells the whole story.
  if (second.status === 'error') {
    return { ...second, error: `${second.error} (after retry; first: ${first.error})` };
  }
  return second;
}
