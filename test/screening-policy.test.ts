import { describe, expect, it } from 'vitest';

import {
  buildScreeningPolicy,
  metadataPrefilter,
  shouldWriteFullReport,
} from '../batch/screening-policy.mjs';

describe('screening policy', () => {
  it('screens metadata that matches profile search terms', () => {
    const policy = buildScreeningPolicy(
      { advanced: { score_threshold: 3 } },
      { search: { terms: ['Solutions Engineer', 'Developer Advocate'] } },
    );

    expect(
      metadataPrefilter(
        { title: 'Senior Solutions Engineer', company: 'Acme', url: 'https://example.com' },
        policy,
      ),
    ).toEqual({ action: 'screen' });
  });

  it('discard-filters obvious title misses before spending on an LLM call', () => {
    const policy = buildScreeningPolicy(
      { advanced: { score_threshold: 3 } },
      { search: { terms: ['Solutions Engineer', 'Developer Advocate'] } },
    );

    expect(
      metadataPrefilter(
        { title: 'Enterprise Account Executive', company: 'Acme', url: 'https://example.com' },
        policy,
      ),
    ).toEqual({
      action: 'discard',
      reason: 'title does not match target search terms',
    });
  });

  it('keeps unknown titles screenable to avoid rejecting user-added URLs blindly', () => {
    const policy = buildScreeningPolicy(
      { advanced: { score_threshold: 3 } },
      { search: { terms: ['Solutions Engineer'] } },
    );

    expect(
      metadataPrefilter({ title: '', company: '', url: 'https://example.com' }, policy),
    ).toEqual({
      action: 'screen',
    });
  });

  it('uses the score threshold to decide whether a full report is worth writing', () => {
    expect(shouldWriteFullReport('2.9/5', 3)).toBe(false);
    expect(shouldWriteFullReport('3.0/5', 3)).toBe(true);
    expect(shouldWriteFullReport('1.0/5', 0)).toBe(true);
  });
});
