// Regression (2026-06-06): every LinkedIn fetch was hardcoded `incomplete`
// (SPA_HOSTS assumption), so the screen prompt's __JD_INCOMPLETE__ rule
// stamped 287/303 scanned offers low_confidence with the legitimacy axis at
// 2.5 — dragging the 6-axis average down ~0.2-0.35 and mass-discarding
// borderline offers. LinkedIn guest pages actually server-render the JD in
// <div class="show-more-less-html__markup"> — extract it and return 'ok';
// 'incomplete' is reserved for pages where the container is genuinely absent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractLinkedInJd,
  extractLinkedInTopCard,
  fetchJobDescription,
} from '../batch/jd-fetcher.mjs';

const noSleep = () => Promise.resolve();
afterEach(() => vi.unstubAllGlobals());

const SHELL_BOILERPLATE = `<nav>${'Jobs People Learning Sign in '.repeat(80)}</nav>`;

const JD_BODY = [
  'We are hiring a Solutions Engineer to drive customer engagements.',
  '<ul><li>5+ years of pre-sales experience</li><li>Strong API and integration background</li></ul>',
  '<div>Base salary range: $140K-$170K plus bonus.</div>',
  'Responsibilities include demos, POCs, and onboarding.'.repeat(5),
].join('\n');

// Top-card mirrors LinkedIn's guest-page markup: the job's own <h1
// class="...topcard__title">, the org link, and the location bullet span.
// Regression (2026-06-06 #2): container-only extraction dropped this header,
// so screens lost the posting's location entirely — and before that, the
// whole-page text fed the model LinkedIn's geo-targeted chrome ("Los
// Angeles, CA Expand search"), which it read as the job's location.
const TOP_CARD = `<h1 class="top-card-layout__title font-sans topcard__title">Senior Solutions Engineer - AirDial</h1>
<span class="topcard__flavor"><a class="topcard__org-name-link topcard__flavor--black-link" href="https://www.linkedin.com/company/ooma">Ooma, Inc.</a></span>
<span class="topcard__flavor topcard__flavor--bullet"> United States </span>`;

const LINKEDIN_FULL_PAGE = `<html><body>
${SHELL_BOILERPLATE}
${TOP_CARD}
<section class="description">
  <div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5 relative overflow-hidden">
    ${JD_BODY}
  </div>
</section>
<footer>${'About Accessibility Talent Solutions '.repeat(50)}</footer>
</body></html>`;

const LINKEDIN_SHELL_ONLY = `<html><body>${SHELL_BOILERPLATE}<footer>${'About Accessibility Talent Solutions '.repeat(50)}</footer></body></html>`;

function stubFetch(html) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => html,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('extractLinkedInJd', () => {
  it('extracts the JD container text, handling nested divs', () => {
    const text = extractLinkedInJd(LINKEDIN_FULL_PAGE);
    expect(text).toContain('Solutions Engineer');
    expect(text).toContain('$140K-$170K');
    expect(text).toContain('Responsibilities include demos');
    // Shell chrome must NOT leak into the JD text.
    expect(text).not.toContain('Talent Solutions');
    expect(text).not.toContain('Sign in');
  });

  it('returns null when the container is absent', () => {
    expect(extractLinkedInJd(LINKEDIN_SHELL_ONLY)).toBeNull();
  });
});

describe('extractLinkedInTopCard', () => {
  it('pulls the posting title, company, and location from the page header', () => {
    const tc = extractLinkedInTopCard(LINKEDIN_FULL_PAGE);
    expect(tc).toEqual({
      title: 'Senior Solutions Engineer - AirDial',
      company: 'Ooma, Inc.',
      location: 'United States',
    });
  });

  it('returns null fields when the top-card is absent', () => {
    expect(extractLinkedInTopCard(LINKEDIN_SHELL_ONLY)).toEqual({
      title: null,
      company: null,
      location: null,
    });
  });
});

describe('fetchJobDescription on LinkedIn', () => {
  it("server-rendered JD container → status 'ok' with top-card header + container text", async () => {
    stubFetch(LINKEDIN_FULL_PAGE);
    const res = await fetchJobDescription('https://www.linkedin.com/jobs/view/123', {
      sleep: noSleep,
    });
    expect(res.status).toBe('ok');
    // The posting's own location must reach the model — it lives in the
    // top-card, outside the JD container.
    expect(res.text).toContain('Location (from the posting page header): United States');
    expect(res.text).toContain('Title: Senior Solutions Engineer - AirDial');
    expect(res.text).toContain('Solutions Engineer');
    expect(res.text).not.toContain('Talent Solutions');
  });

  it("genuine SPA shell (no container) → status 'incomplete' even when text > 800 chars", async () => {
    stubFetch(LINKEDIN_SHELL_ONLY);
    const res = await fetchJobDescription('https://www.linkedin.com/jobs/view/456', {
      sleep: noSleep,
    });
    expect(res.status).toBe('incomplete');
  });
});
