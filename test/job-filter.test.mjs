// test/job-filter.test.mjs
//
// Shared scanner sieves (batch/lib/job-filter.mjs) used by BOTH scan-portals
// and scan-jobspy. Title is positive-only; location is derived from profile.yml
// (the same fields JobSpy crawls by). Pure functions — no I/O.

import { describe, expect, it } from 'vitest';
import {
  buildLocationMatcher,
  buildTitleMatcher,
  normalizeTitle,
} from '../batch/lib/job-filter.mjs';

describe('buildTitleMatcher', () => {
  it('keeps titles containing a search term, drops the rest', () => {
    const m = buildTitleMatcher({ search: { terms: ['AI Engineer', 'ML Engineer'] } });
    expect(m('Senior AI Engineer, US')).toBe(true);
    expect(m('Forward Deployed Engineer')).toBe(false);
  });

  it('normalizes punctuation so hyphenated titles match bare keywords', () => {
    const m = buildTitleMatcher({ search: { terms: ['Forward Deployed Engineer'] } });
    expect(m('Forward-Deployed Engineer')).toBe(true);
  });

  it('passes everything when no terms are configured', () => {
    expect(buildTitleMatcher({})('Anything at all')).toBe(true);
    expect(buildTitleMatcher({ search: { terms: [] } })('Anything')).toBe(true);
  });

  it('normalizeTitle lowercases, strips separators, collapses whitespace', () => {
    expect(normalizeTitle('Forward-Deployed  (Engineer)')).toBe('forward deployed engineer');
  });
});

describe('buildLocationMatcher', () => {
  const strict = buildLocationMatcher({
    location: {
      onsite_availability: 'remote',
      location_flexibility: 'strict',
      country: 'United States',
    },
    search: { locations: ['San Francisco, CA'] },
  });

  it('strict: keeps specific locations and remote, drops off-location (country ignored)', () => {
    expect(strict('San Francisco, CA, USA')).toBe(true); // specific match
    expect(strict('Remote - US')).toBe(true); // remote-ok
    expect(strict('Tokyo, Japan')).toBe(false); // off-location
    expect(strict('New York, NY')).toBe(false); // country not honored under strict
  });

  it('passes empty / missing location strings (no penalty for missing data)', () => {
    expect(strict('')).toBe(true);
    expect(strict('   ')).toBe(true);
    expect(strict(undefined)).toBe(true);
  });

  it('flexible: also honors the country, still drops other countries', () => {
    const flexible = buildLocationMatcher({
      location: {
        onsite_availability: 'onsite',
        location_flexibility: 'flexible',
        country: 'United States',
      },
      search: { locations: ['San Francisco, CA'] },
    });
    expect(flexible('San Francisco, CA')).toBe(true);
    expect(flexible('United States')).toBe(true); // country match
    expect(flexible('Tokyo, Japan')).toBe(false);
    // onsite candidate (not remote-ok): a remote posting must still match a place
    expect(flexible('Remote - Anywhere')).toBe(false);
  });

  it('open: disables location filtering entirely', () => {
    const open = buildLocationMatcher({
      location: { location_flexibility: 'open' },
      search: { locations: ['San Francisco, CA'] },
    });
    expect(open('Tokyo, Japan')).toBe(true);
  });

  it('passes everything when there is nothing to constrain on', () => {
    // onsite (not remote-ok), strict, no search.locations, no country → no allow list.
    const m = buildLocationMatcher({
      location: { onsite_availability: 'onsite', location_flexibility: 'strict' },
    });
    expect(m('Tokyo, Japan')).toBe(true);
  });

  it('defaults (no location config) keep specific-only behavior with remote allowed', () => {
    // onsite_availability defaults to 'open' → remote allowed; flexibility 'strict'.
    const m = buildLocationMatcher({ search: { locations: ['Berlin'] } });
    expect(m('Berlin, Germany')).toBe(true);
    expect(m('Remote - EU')).toBe(true); // default onsite 'open' is remote-ok
    expect(m('Paris, France')).toBe(false);
  });
});

describe('buildLocationMatcher — word boundaries (review fixes)', () => {
  it('a short country code matches only as a whole token, not inside a word', () => {
    const m = buildLocationMatcher({
      location: { onsite_availability: 'onsite', location_flexibility: 'flexible', country: 'US' },
    });
    expect(m('Sydney, Australia')).toBe(false); // "us" not a standalone token
    expect(m('Remote - US')).toBe(true); // "US" is a token (country, flexible)
    expect(m('Austin, TX')).toBe(false); // "us" inside "austin" doesn't count
  });

  it('"india" does not match "Indianapolis"', () => {
    const m = buildLocationMatcher({
      location: {
        onsite_availability: 'onsite',
        location_flexibility: 'flexible',
        country: 'India',
      },
    });
    expect(m('Indianapolis, IN')).toBe(false);
    expect(m('Bangalore, India')).toBe(true);
  });

  it('hybrid does NOT auto-pass remote postings — it needs a location match', () => {
    const m = buildLocationMatcher({
      location: {
        onsite_availability: 'hybrid',
        location_flexibility: 'strict',
        country: 'United States',
      },
      search: { locations: ['San Francisco, CA'] },
    });
    expect(m('Remote - India')).toBe(false);
    expect(m('San Francisco, CA')).toBe(true);
  });

  it('blank search.locations keywords are ignored (no match-everything)', () => {
    const m = buildLocationMatcher({
      location: { onsite_availability: 'onsite', location_flexibility: 'strict' },
      search: { locations: ['', '   ', 'Berlin'] },
    });
    expect(m('Tokyo, Japan')).toBe(false);
    expect(m('Berlin, DE')).toBe(true);
  });
});
