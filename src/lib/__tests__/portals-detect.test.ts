// URL → {provider, name, careers_url, api} derivation for the Settings →
// ATS portals smart-add composer, plus the shared provider display map.

import { describe, expect, it } from 'vitest';
import {
  deriveCompanyFromUrl,
  hasCustomParser,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
} from '../portals-detect';

describe('deriveCompanyFromUrl', () => {
  it('derives Greenhouse (US board) with the boards-api endpoint', () => {
    expect(deriveCompanyFromUrl('https://job-boards.greenhouse.io/anthropic')).toEqual({
      provider: 'greenhouse',
      name: 'Anthropic',
      careers_url: 'https://job-boards.greenhouse.io/anthropic',
      api: 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs',
    });
  });

  it('derives Greenhouse (EU board) with the boards-api endpoint', () => {
    expect(deriveCompanyFromUrl('https://job-boards.eu.greenhouse.io/polyai')).toEqual({
      provider: 'greenhouse',
      name: 'Polyai',
      careers_url: 'https://job-boards.eu.greenhouse.io/polyai',
      api: 'https://boards-api.greenhouse.io/v1/boards/polyai/jobs',
    });
  });

  it('derives Greenhouse from the legacy boards.greenhouse.io host', () => {
    const derived = deriveCompanyFromUrl('https://boards.greenhouse.io/vercel');
    expect(derived?.provider).toBe('greenhouse');
    expect(derived?.api).toBe('https://boards-api.greenhouse.io/v1/boards/vercel/jobs');
  });

  it('derives Ashby without an api field', () => {
    expect(deriveCompanyFromUrl('https://jobs.ashbyhq.com/cohere')).toEqual({
      provider: 'ashby',
      name: 'Cohere',
      careers_url: 'https://jobs.ashbyhq.com/cohere',
    });
  });

  it('derives Lever', () => {
    expect(deriveCompanyFromUrl('https://jobs.lever.co/mistral')).toEqual({
      provider: 'lever',
      name: 'Mistral',
      careers_url: 'https://jobs.lever.co/mistral',
    });
  });

  it('derives Workable (apply.workable.com form, trailing slash)', () => {
    expect(deriveCompanyFromUrl('https://apply.workable.com/huggingface/')).toEqual({
      provider: 'workable',
      name: 'Huggingface',
      careers_url: 'https://apply.workable.com/huggingface/',
    });
  });

  it('derives Workable (company-subdomain form)', () => {
    expect(deriveCompanyFromUrl('https://acme-corp.workable.com/')).toEqual({
      provider: 'workable',
      name: 'Acme Corp',
      careers_url: 'https://acme-corp.workable.com/',
    });
  });

  it('derives Workday, naming the company after the tenant', () => {
    expect(
      deriveCompanyFromUrl('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite'),
    ).toEqual({
      provider: 'workday',
      name: 'Nvidia',
      careers_url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
    });
  });

  it('derives Recruitee, naming the company after the subdomain', () => {
    expect(deriveCompanyFromUrl('https://acme.recruitee.com/')).toEqual({
      provider: 'recruitee',
      name: 'Acme',
      careers_url: 'https://acme.recruitee.com/',
    });
  });

  it('derives SmartRecruiters from the careers/jobs host', () => {
    expect(deriveCompanyFromUrl('https://careers.smartrecruiters.com/acme')).toEqual({
      provider: 'smartrecruiters',
      name: 'Acme',
      careers_url: 'https://careers.smartrecruiters.com/acme',
    });
    expect(deriveCompanyFromUrl('https://jobs.smartrecruiters.com/acme')?.provider).toBe(
      'smartrecruiters',
    );
  });

  it('derives SolidJobs from the public-api endpoint, naming it after the division', () => {
    expect(deriveCompanyFromUrl('https://solid.jobs/public-api/offers/it')).toEqual({
      provider: 'solidjobs',
      name: 'It',
      careers_url: 'https://solid.jobs/public-api/offers/it',
    });
  });

  it('title-cases multi-word slugs', () => {
    expect(deriveCompanyFromUrl('https://jobs.lever.co/trade-republic')?.name).toBe(
      'Trade Republic',
    );
  });

  it('still derives a row for an unknown provider (not scannable)', () => {
    expect(deriveCompanyFromUrl('https://careers.example.com/openings')).toEqual({
      provider: null,
      name: 'Example',
      careers_url: 'https://careers.example.com/openings',
    });
  });

  it('returns null for empty / whitespace input', () => {
    expect(deriveCompanyFromUrl('')).toBeNull();
    expect(deriveCompanyFromUrl('   ')).toBeNull();
  });

  it('returns null for non-URL input and non-http(s) protocols', () => {
    expect(deriveCompanyFromUrl('anthropic')).toBeNull();
    expect(deriveCompanyFromUrl('ftp://job-boards.greenhouse.io/anthropic')).toBeNull();
  });

  it('trims surrounding whitespace before parsing', () => {
    const derived = deriveCompanyFromUrl('  https://jobs.lever.co/qonto  ');
    expect(derived?.provider).toBe('lever');
    expect(derived?.careers_url).toBe('https://jobs.lever.co/qonto');
  });
});

describe('hasCustomParser', () => {
  it('is true only when a parser block carries a command', () => {
    expect(hasCustomParser({ parser: { command: 'node' } })).toBe(true);
    expect(hasCustomParser({ parser: { command: '' } })).toBe(false);
    expect(hasCustomParser({ parser: {} })).toBe(false);
    expect(hasCustomParser({})).toBe(false);
  });
});

describe('provider display map', () => {
  it('labels every provider in display order (single mapping point)', () => {
    expect(PROVIDER_ORDER.map(p => PROVIDER_LABELS[p])).toEqual([
      'Greenhouse',
      'Ashby',
      'Lever',
      'Workable',
      'Workday',
      'Recruitee',
      'SmartRecruiters',
      'SolidJobs',
    ]);
  });
});
