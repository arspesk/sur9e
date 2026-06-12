import { describe, expect, it } from 'vitest';
import { validateReport } from '../report-schema';

// Cumulative-review I4 regression net for commit 6bfe9c1: validateReport
// previously truncated prose + row fields with "…" — that clipped legitimate
// content in the offer drawer / full report. The caps were dropped; these
// tests guard against a future refactor reintroducing the truncate() call
// upstream of validateReport. SHORT_FIELD_CAPS (tracker-row column widths)
// are intentionally still enforced and are covered by the test suite in
// test-all.mjs ("validateReport: short field truncates with ellipsis").

describe('validateReport — prose fields not truncated', () => {
  it('keeps a 1000-char tldr intact', () => {
    const longTldr = 'x'.repeat(1000);
    const out = validateReport({ tldr: longTldr });
    const tldr = out['tldr'] as string;
    expect(tldr.length).toBe(1000);
    expect(tldr).toBe(longTldr);
    expect(tldr.endsWith('…')).toBeFalsy();
  });

  it('keeps a 600-char verdict intact', () => {
    const out = validateReport({ verdict: 'y'.repeat(600) });
    const verdict = out['verdict'] as string;
    expect(verdict.length).toBe(600);
    expect(verdict.endsWith('…')).toBeFalsy();
  });

  it('keeps long analysis / demand / notes intact', () => {
    const out = validateReport({
      analysis: 'a'.repeat(800),
      demand: 'd'.repeat(500),
      notes: 'n'.repeat(900),
    });
    expect((out['analysis'] as string).length).toBe(800);
    expect((out['demand'] as string).length).toBe(500);
    expect((out['notes'] as string).length).toBe(900);
  });
});

describe('validateReport — row fields not truncated', () => {
  it('keeps a long cv_match.jd / cv intact', () => {
    const longJd =
      'Provide technical consultation during pre-sales engagements with strategic Enterprise customers across APAC and EMEA regions';
    const longCv =
      'demos/POCs, presented architectures to non-technical audiences during multiple Anthropic deployment cycles';
    const out = validateReport({
      cv_match: [{ jd: longJd, cv: longCv, strength: 'strong' }],
    });
    const cvMatch = out['cv_match'] as Record<string, string>[];
    expect(cvMatch.length).toBe(1);
    expect(cvMatch[0]['jd']).toBe(longJd);
    expect(cvMatch[0]['cv']).toBe(longCv);
    expect(cvMatch[0]['jd'].endsWith('…')).toBeFalsy();
    expect(cvMatch[0]['cv'].endsWith('…')).toBeFalsy();
  });

  it('keeps long gap.title / gap.mitigation intact', () => {
    const out = validateReport({
      gaps: [
        {
          title:
            'Long gap title that previously got cut off at the 80-char cap with an ellipsis trailing',
          mitigation:
            "Long mitigation describing how to bridge the gap with concrete examples and stories drawn from the candidate's experience at multiple senior roles across two continents and several growth-stage startups",
          severity: 'medium',
        },
      ],
    });
    const gaps = out['gaps'] as Record<string, string>[];
    expect(gaps.length).toBe(1);
    expect(gaps[0]['title'].endsWith('…')).toBeFalsy();
    expect(gaps[0]['mitigation'].endsWith('…')).toBeFalsy();
    expect(gaps[0]['mitigation'].length > 140).toBeTruthy();
  });

  it('keeps long stars (s/t/a/r/reflection) intact', () => {
    const star = {
      theme: 'Enterprise Customer Engineering with deep technical onboarding',
      s: 's'.repeat(300),
      t: 't'.repeat(300),
      a: 'a'.repeat(400),
      r: 'r'.repeat(400),
      reflection: 'r'.repeat(400),
    };
    const out = validateReport({ stars: [star] });
    const stars = out['stars'] as Record<string, string>[];
    expect(stars[0]['s'].length).toBe(300);
    expect(stars[0]['t'].length).toBe(300);
    expect(stars[0]['a'].length).toBe(400);
    expect(stars[0]['r'].length).toBe(400);
    expect(stars[0]['reflection'].length).toBe(400);
  });

  it('keeps long cv_adjustments intact', () => {
    const out = validateReport({
      cv_adjustments: [
        {
          section: 'Experience — Anthropic',
          current: 'c'.repeat(500),
          proposed: 'p'.repeat(500),
          why: 'w'.repeat(300),
        },
      ],
    });
    const cvAdj = out['cv_adjustments'] as Record<string, string>[];
    expect(cvAdj[0]['current'].length).toBe(500);
    expect(cvAdj[0]['proposed'].length).toBe(500);
    expect(cvAdj[0]['why'].length).toBe(300);
  });
});

describe('validateReport — short fields still capped', () => {
  // Sanity-check the caps that ARE preserved (tracker-row columns).
  it('archetype_short still capped at 24 with ellipsis', () => {
    const out = validateReport({ archetype_short: 'X'.repeat(50) });
    const archShort = out['archetype_short'] as string;
    expect(archShort.length).toBe(24);
    expect(archShort.endsWith('…')).toBeTruthy();
  });
});
