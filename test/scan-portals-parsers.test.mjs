// test/scan-portals-parsers.test.mjs
//
// Per-ATS parser tests over fixture API responses (shapes mirror the live
// payloads probed 2026-06-10). Each parser captures the optional `posted`
// (true posting date, YYYY-MM-DD) from the field its ATS exposes; absent or
// invalid dates omit the key entirely — never an empty string. No network,
// no user-data writes: pure JSON in, offer objects out.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertAtsUrl,
  expandParserArg,
  fetchLocalParser,
  parseAshby,
  parseGreenhouse,
  parseLever,
  parseLocal,
  parseRecruitee,
  parseSmartrecruiters,
  parseSolidjobs,
  parseWorkable,
  parseWorkday,
} from '../batch/scan-portals.mjs';

describe('parseGreenhouse', () => {
  it('captures posted from first_published, preferring it over updated_at', () => {
    const json = {
      jobs: [
        {
          title: 'Solutions Engineer',
          absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
          location: { name: 'Remote - US' },
          first_published: '2026-06-01T11:00:00-04:00',
          updated_at: '2026-06-09T07:00:30-04:00',
        },
      ],
    };
    const [job] = parseGreenhouse(json, 'Acme');
    expect(job).toEqual({
      title: 'Solutions Engineer',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      company: 'Acme',
      location: 'Remote - US',
      posted: '2026-06-01',
    });
  });

  it('falls back to updated_at when first_published is absent', () => {
    const json = {
      jobs: [{ title: 'SE', absolute_url: 'u', updated_at: '2026-06-09T07:00:30-04:00' }],
    };
    expect(parseGreenhouse(json, 'Acme')[0].posted).toBe('2026-06-09');
  });

  it('omits posted entirely when both date fields are absent', () => {
    const json = { jobs: [{ title: 'SE', absolute_url: 'u' }] };
    const [job] = parseGreenhouse(json, 'Acme');
    expect('posted' in job).toBe(false);
  });

  it('tolerates an empty payload', () => {
    expect(parseGreenhouse({}, 'Acme')).toEqual([]);
  });
});

describe('parseAshby', () => {
  it('captures posted from publishedAt', () => {
    const json = {
      jobs: [
        {
          title: 'Forward Deployed Engineer',
          jobUrl: 'https://jobs.ashbyhq.com/acme/123',
          location: 'San Francisco',
          publishedAt: '2026-05-30T08:12:00.000Z',
        },
      ],
    };
    const [job] = parseAshby(json, 'Acme');
    expect(job.posted).toBe('2026-05-30');
    expect(job.url).toBe('https://jobs.ashbyhq.com/acme/123');
  });

  it('omits posted when publishedAt is absent or invalid', () => {
    expect('posted' in parseAshby({ jobs: [{ title: 'X', jobUrl: 'u' }] }, 'A')[0]).toBe(false);
    expect(
      'posted' in parseAshby({ jobs: [{ title: 'X', jobUrl: 'u', publishedAt: 'soon' }] }, 'A')[0],
    ).toBe(false);
  });
});

describe('parseLever', () => {
  it('converts createdAt epoch milliseconds to a UTC calendar date', () => {
    const json = [
      {
        text: 'Sales Engineer',
        hostedUrl: 'https://jobs.lever.co/acme/abc',
        categories: { location: 'Remote' },
        createdAt: Date.UTC(2026, 4, 15, 12, 0, 0),
      },
    ];
    const [job] = parseLever(json, 'Acme');
    expect(job.posted).toBe('2026-05-15');
    expect(job.title).toBe('Sales Engineer');
  });

  it('omits posted when createdAt is absent or not a number', () => {
    expect('posted' in parseLever([{ text: 'X', hostedUrl: 'u' }], 'A')[0]).toBe(false);
    expect(
      'posted' in parseLever([{ text: 'X', hostedUrl: 'u', createdAt: '2026-05-15' }], 'A')[0],
    ).toBe(false);
  });

  it('returns [] for a non-array payload', () => {
    expect(parseLever({ error: 'not found' }, 'A')).toEqual([]);
  });
});

describe('parseWorkable', () => {
  it('captures posted from published_on (date-only string)', () => {
    const json = {
      jobs: [
        {
          title: 'Solutions Architect',
          url: 'https://apply.workable.com/acme/j/ABC/',
          location: { location_str: 'Berlin, Germany' },
          published_on: '2026-06-08',
        },
      ],
    };
    expect(parseWorkable(json, 'Acme')[0].posted).toBe('2026-06-08');
  });

  it('falls back to created_at when published_on is absent', () => {
    const json = { jobs: [{ title: 'X', url: 'u', created_at: '2026-06-01T00:00:00Z' }] };
    expect(parseWorkable(json, 'A')[0].posted).toBe('2026-06-01');
  });

  it('omits posted when the payload carries no date fields (documented: some widget responses omit them)', () => {
    const [job] = parseWorkable({ jobs: [{ title: 'X', url: 'u' }] }, 'A');
    expect('posted' in job).toBe(false);
  });
});

describe('parseWorkday', () => {
  const apiInfo = { _workdayBase: 'https://acme.wd1.myworkdayjobs.com' };
  const SCAN = '2026-06-10';

  it('resolves relative postedOn text against the scan date', () => {
    const json = {
      jobPostings: [
        {
          title: 'SE',
          externalPath: '/job/SE_1',
          locationsText: 'Austin',
          postedOn: 'Posted 3 Days Ago',
        },
        { title: 'AE', externalPath: '/job/AE_1', locationsText: 'NYC', postedOn: 'Posted Today' },
        {
          title: 'CSM',
          externalPath: '/job/CSM_1',
          locationsText: 'Remote',
          postedOn: 'Posted 30+ Days Ago',
        },
      ],
    };
    const jobs = parseWorkday(json, 'Acme', apiInfo, SCAN);
    expect(jobs[0].posted).toBe('2026-06-07');
    expect(jobs[0].url).toBe('https://acme.wd1.myworkdayjobs.com/job/SE_1');
    expect(jobs[1].posted).toBe('2026-06-10');
    expect(jobs[2].posted).toBe('2026-05-11'); // newest the posting could be
  });

  it('omits posted for unparseable relative text and absent postedOn', () => {
    const json = {
      jobPostings: [
        { title: 'SE', externalPath: '/job/SE_2', postedOn: 'Posted Recently' },
        { title: 'AE', externalPath: '/job/AE_2' },
      ],
    };
    const jobs = parseWorkday(json, 'Acme', apiInfo, SCAN);
    expect('posted' in jobs[0]).toBe(false);
    expect('posted' in jobs[1]).toBe(false);
  });
});

describe('parseRecruitee', () => {
  it('assembles location and keeps only same-host offer URLs', () => {
    const json = {
      offers: [
        {
          title: 'Solutions Engineer',
          careers_url: 'https://acme.recruitee.com/o/solutions-engineer',
          city: 'Berlin',
          country: 'Germany',
          remote: true,
          published_at: '2026-06-02T10:00:00Z',
        },
      ],
    };
    expect(parseRecruitee(json, 'Acme')[0]).toEqual({
      title: 'Solutions Engineer',
      url: 'https://acme.recruitee.com/o/solutions-engineer',
      company: 'Acme',
      location: 'Berlin, Germany, Remote',
      posted: '2026-06-02',
    });
  });

  it('drops an off-domain offer URL but keeps the row', () => {
    const json = { offers: [{ title: 'X', url: 'https://evil.com/o/1', city: 'NY' }] };
    const [job] = parseRecruitee(json, 'Acme');
    expect(job.url).toBe('');
    expect(job.location).toBe('NY');
    expect('posted' in job).toBe(false);
  });

  it('prefers an explicit location field', () => {
    const json = { offers: [{ title: 'X', location: 'Remote - EU', city: 'NY', country: 'US' }] };
    expect(parseRecruitee(json, 'Acme')[0].location).toBe('Remote - EU');
  });
});

describe('parseSmartrecruiters', () => {
  it('rewrites the api ref to the public jobs URL and assembles location', () => {
    const json = {
      content: [
        {
          name: 'Forward Deployed Engineer',
          ref: 'https://api.smartrecruiters.com/v1/companies/acme/postings/abc123',
          location: { city: 'Austin', region: 'TX', country: 'US', remote: true },
          releasedDate: '2026-06-03T09:00:00Z',
        },
      ],
    };
    expect(parseSmartrecruiters(json, 'Acme')[0]).toEqual({
      title: 'Forward Deployed Engineer',
      url: 'https://jobs.smartrecruiters.com/acme/postings/abc123',
      company: 'Acme',
      location: 'Austin, TX, US, Remote',
      posted: '2026-06-03',
    });
  });

  it('drops a non-api ref, leaving an empty URL', () => {
    const json = { content: [{ name: 'X', ref: 'https://evil.com/x', location: {} }] };
    expect(parseSmartrecruiters(json, 'Acme')[0].url).toBe('');
  });

  it('prefers fullLocation when present', () => {
    const json = { content: [{ name: 'X', location: { fullLocation: 'London, UK' } }] };
    expect(parseSmartrecruiters(json, 'Acme')[0].location).toBe('London, UK');
  });
});

describe('parseSolidjobs', () => {
  it('keeps the external offer URL and joins array locations', () => {
    const json = {
      jobs: [
        {
          title: 'Backend Engineer',
          url: 'https://acme.example.com/jobs/42',
          company: 'Acme',
          locations: ['Madrid', 'Remote'],
          publishedDate: '2026-06-04T00:00:00Z',
        },
      ],
    };
    expect(parseSolidjobs(json, 'Fallback')[0]).toEqual({
      title: 'Backend Engineer',
      url: 'https://acme.example.com/jobs/42',
      company: 'Acme',
      location: 'Madrid, Remote',
      posted: '2026-06-04',
    });
  });

  it('drops rows without a URL and falls back to the entry name for company', () => {
    const json = {
      jobs: [
        { title: 'No URL', url: '', locations: 'X' },
        { title: 'Has URL', url: 'https://x/1', locations: 'Berlin' },
      ],
    };
    const out = parseSolidjobs(json, 'EntryName');
    expect(out).toHaveLength(1);
    expect(out[0].company).toBe('EntryName');
    expect(out[0].location).toBe('Berlin');
  });
});

describe('parseLocal (universal-scanner escape hatch)', () => {
  it('shapes a bare array, resolving relative URLs against careers_url', () => {
    const api = { careersUrl: 'https://acme.example.com/careers' };
    const out = parseLocal(
      [{ title: 'Solutions Engineer', url: '/jobs/42', location: 'Berlin' }],
      'Acme',
      api,
    );
    expect(out).toEqual([
      {
        title: 'Solutions Engineer',
        url: 'https://acme.example.com/jobs/42',
        company: 'Acme',
        location: 'Berlin',
      },
    ]);
  });

  it('accepts { jobs } and { results } wrappers and assorted field aliases', () => {
    const fromJobs = parseLocal({ jobs: [{ name: 'AE', job_url: 'https://x/1' }] }, 'Acme', {});
    expect(fromJobs[0]).toMatchObject({ title: 'AE', url: 'https://x/1', company: 'Acme' });
    const fromResults = parseLocal(
      { results: [{ title: 'SE', applyUrl: 'https://x/2' }] },
      'Acme',
      {},
    );
    expect(fromResults[0]).toMatchObject({ title: 'SE', url: 'https://x/2' });
  });

  it('drops rows missing a title or an unresolvable URL', () => {
    const out = parseLocal(
      [
        { title: '', url: 'https://x/1' },
        { title: 'No URL' },
        { title: 'Bad URL', url: 'not a url' },
        { title: 'Good', url: 'https://x/2' },
      ],
      'Acme',
      {},
    );
    expect(out.map(j => j.title)).toEqual(['Good']);
  });

  it('normalizes location given as a string, array, or {name}/{text} object', () => {
    const api = {};
    expect(
      parseLocal([{ title: 'A', url: 'https://x/1', location: ['Berlin', 'Remote'] }], 'C', api)[0]
        .location,
    ).toBe('Berlin, Remote');
    expect(
      parseLocal([{ title: 'A', url: 'https://x/1', location: { name: 'Madrid' } }], 'C', api)[0]
        .location,
    ).toBe('Madrid');
    expect(
      parseLocal([{ title: 'A', url: 'https://x/1', locations: { text: 'NYC' } }], 'C', api)[0]
        .location,
    ).toBe('NYC');
  });

  it('captures posted from posted/published_at/date and prefers an explicit company', () => {
    const [job] = parseLocal(
      [{ title: 'A', url: 'https://x/1', company: 'RealCo', date: '2026-06-04' }],
      'Fallback',
      {},
    );
    expect(job.company).toBe('RealCo');
    expect(job.posted).toBe('2026-06-04');
  });

  it('tolerates junk input (non-object rows, non-array payloads)', () => {
    expect(parseLocal(null, 'C', {})).toEqual([]);
    expect(parseLocal({ jobs: 'nope' }, 'C', {})).toEqual([]);
    expect(parseLocal([null, 5, 'x'], 'C', {})).toEqual([]);
  });
});

describe('fetchLocalParser (spawn + security boundary)', () => {
  // A throwaway repo root with inputs/parsers/ fixtures — never the real tree.
  let root;
  let parsersDir;
  const opts = () => ({ root, parsersDir });

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-parser-'));
    parsersDir = join(root, 'inputs', 'parsers');
    mkdirSync(parsersDir, { recursive: true });
    // Prints a fixed job list.
    writeFileSync(
      join(parsersDir, 'ok.mjs'),
      `process.stdout.write(JSON.stringify({ jobs: [{ title: 'SE', url: 'https://acme/1' }] }));\n`,
    );
    // Echoes the --url arg back as a job URL, to prove arg expansion reaches it.
    writeFileSync(
      join(parsersDir, 'echo-url.mjs'),
      `const i = process.argv.indexOf('--url');
process.stdout.write(JSON.stringify({ jobs: [{ title: 'SE', url: process.argv[i + 1] }] }));\n`,
    );
    // Prints non-JSON.
    writeFileSync(join(parsersDir, 'garbage.mjs'), `process.stdout.write('not json {');\n`);
    // An out-of-tree script + a symlink to it INSIDE inputs/parsers/: the lexical
    // guard passes (the link lives in-bounds) but the canonical target escapes.
    writeFileSync(
      join(root, 'outside.mjs'),
      `process.stdout.write(JSON.stringify({ jobs: [] }));\n`,
    );
    symlinkSync(join(root, 'outside.mjs'), join(parsersDir, 'link.mjs'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs an allowlisted interpreter and returns the parsed stdout JSON', async () => {
    const api = { parser: { command: 'node', script: 'inputs/parsers/ok.mjs' }, careersUrl: '' };
    await expect(fetchLocalParser(api, 'Acme', opts())).resolves.toEqual({
      jobs: [{ title: 'SE', url: 'https://acme/1' }],
    });
  });

  it('substitutes {careers_url} into args before spawning', async () => {
    const api = {
      parser: {
        command: 'node',
        script: 'inputs/parsers/echo-url.mjs',
        args: ['--url', '{careers_url}'],
      },
      careersUrl: 'https://acme.example.com/careers',
    };
    const json = await fetchLocalParser(api, 'Acme', opts());
    expect(json.jobs[0].url).toBe('https://acme.example.com/careers');
  });

  it('rejects a command outside the interpreter allowlist', async () => {
    const api = { parser: { command: 'rm', script: 'inputs/parsers/ok.mjs' }, careersUrl: '' };
    await expect(fetchLocalParser(api, 'Acme', opts())).rejects.toThrow(/not allowed/);
  });

  it('rejects a missing script path', async () => {
    const api = { parser: { command: 'node' }, careersUrl: '' };
    await expect(fetchLocalParser(api, 'Acme', opts())).rejects.toThrow(/script/);
  });

  it('rejects a script that escapes inputs/parsers/ via traversal', async () => {
    const api = {
      parser: { command: 'node', script: 'inputs/parsers/../../escape.mjs' },
      careersUrl: '',
    };
    await expect(fetchLocalParser(api, 'Acme', opts())).rejects.toThrow(/inside inputs\/parsers/);
  });

  it('rejects a symlink inside inputs/parsers/ whose target escapes the tree', async () => {
    const api = { parser: { command: 'node', script: 'inputs/parsers/link.mjs' }, careersUrl: '' };
    await expect(fetchLocalParser(api, 'Acme', opts())).rejects.toThrow(/inside inputs\/parsers/);
  });

  it('rejects an in-bounds path that does not exist', async () => {
    const api = { parser: { command: 'node', script: 'inputs/parsers/nope.mjs' }, careersUrl: '' };
    await expect(fetchLocalParser(api, 'Acme', opts())).rejects.toThrow(/not found/);
  });

  it('rejects non-JSON stdout', async () => {
    const api = {
      parser: { command: 'node', script: 'inputs/parsers/garbage.mjs' },
      careersUrl: '',
    };
    await expect(fetchLocalParser(api, 'Acme', opts())).rejects.toThrow(/invalid JSON/);
  });
});

describe('expandParserArg', () => {
  it('substitutes both placeholders, leaving other text intact', () => {
    expect(expandParserArg('--url={careers_url}&c={company}', 'https://x/careers', 'Acme')).toBe(
      '--url=https://x/careers&c=Acme',
    );
  });
  it('replaces a missing value with empty string', () => {
    expect(expandParserArg('{careers_url}', '', 'Acme')).toBe('');
  });
});

describe('assertAtsUrl (SSRF host allowlist)', () => {
  const VALID = {
    greenhouse: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs',
    ashby: 'https://api.ashbyhq.com/posting-api/job-board/acme',
    lever: 'https://api.lever.co/v0/postings/acme',
    workable: 'https://apply.workable.com/api/v1/widget/accounts/acme',
    workday: 'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/site/jobs',
    recruitee: 'https://acme.recruitee.com/api/offers/',
    smartrecruiters: 'https://api.smartrecruiters.com/v1/companies/acme/postings',
    solidjobs: 'https://solid.jobs/public-api/offers/it',
  };

  it('accepts the canonical host for every provider', () => {
    for (const [type, url] of Object.entries(VALID)) {
      expect(() => assertAtsUrl(url, type)).not.toThrow();
    }
  });

  it('rejects a look-alike / off-domain host (the weak .includes() hole)', () => {
    expect(() => assertAtsUrl('https://evil.com/?x=greenhouse', 'greenhouse')).toThrow(/untrusted/);
    expect(() => assertAtsUrl('https://boards-api.greenhouse.io.evil.com/x', 'greenhouse')).toThrow(
      /untrusted/,
    );
    expect(() =>
      assertAtsUrl('https://api.smartrecruiters.com.evil.com/x', 'smartrecruiters'),
    ).toThrow(/untrusted/);
  });

  it('rejects non-HTTPS and unknown types', () => {
    expect(() => assertAtsUrl('http://api.lever.co/v0/postings/acme', 'lever')).toThrow(/HTTPS/);
    expect(() => assertAtsUrl('https://api.lever.co/x', 'nope')).toThrow(/untrusted/);
  });

  it('enforces the solidjobs path prefix', () => {
    expect(() => assertAtsUrl('https://solid.jobs/evil', 'solidjobs')).toThrow(/path/);
  });
});

describe('Wave A edge cases', () => {
  it('assertAtsUrl: workday shard regex rejects suffix/missing-shard look-alikes', () => {
    expect(() =>
      assertAtsUrl('https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/s/jobs', 'workday'),
    ).not.toThrow();
    // ".evil.com" suffix and a missing wdN shard must both be rejected.
    expect(() => assertAtsUrl('https://acme.wd1.myworkdayjobs.com.evil.com/x', 'workday')).toThrow(
      /untrusted/,
    );
    expect(() => assertAtsUrl('https://acme.myworkdayjobs.com/x', 'workday')).toThrow(/untrusted/);
  });

  it('new parsers tolerate empty / missing arrays', () => {
    expect(parseRecruitee({}, 'A')).toEqual([]);
    expect(parseRecruitee({ offers: null }, 'A')).toEqual([]);
    expect(parseSmartrecruiters({}, 'A')).toEqual([]);
    expect(parseSolidjobs({}, 'A')).toEqual([]);
  });
});
