import { describe, expect, it } from 'vitest';
import { buildScreenReport } from '../batch/screen.mjs';

const base = { num: 20, slug: 'acme', date: '2026-06-01', url: 'https://acme.com/jobs/1' };
const readable = {
  ...base,
  readable: true,
  company: 'Acme',
  role: 'Solutions Engineer',
  location: 'LA',
  work_mode: 'On-site',
  seniority: 'Mid',
  archetype: 'AI Solutions Engineer',
  domain: 'acme.com',
  comp: '$148K-$173K',
  legitimacy: 'high_confidence',
  score: 3.8,
  score_breakdown: {
    cv_match: 4,
    seniority: 3.5,
    compensation: 3.8,
    domain: 3.5,
    geo: 4.5,
    legitimacy: 4,
  },
  axis_reads: {
    cv_match: 'strong',
    seniority: 'stretch',
    compensation: 'clears',
    domain: 'strong',
    geo: 'remote',
    legitimacy: 'clean',
  },
  headline: 'strong fit, comp clears, watch the YoE gap',
  tldr: '**Strong fit.** Pre-sales SE motion maps direct; comp inside band.',
  strongest_signal: 'three years of pre-sales SE motion maps straight to the role',
  watch_out: 'the JD asks for 6+ years; the candidate sits at 4',
};

describe('buildScreenReport', () => {
  it('follows the contract: Next Steps callout first, bare TL;DR, table, data-callouts', () => {
    const { report, tsv } = buildScreenReport(readable, 3);
    expect(report).toMatch(/^---\n/);
    expect(report).toContain('status: Screened');

    // Next Steps callout is the first body block, above ## TL;DR.
    expect(report).toContain('**Next Steps**');
    expect(report.indexOf('**Next Steps**')).toBeLessThan(report.indexOf('## TL;DR'));

    // Bare heading (no appended headline) + verbatim bold verdict (not double-wrapped).
    expect(report).toContain('\n## TL;DR\n');
    expect(report).not.toContain('## TL;DR:');
    expect(report).toContain('**Strong fit.** Pre-sales SE motion maps direct; comp inside band.');
    expect(report).not.toContain('****');

    // Axis/Score/Read table, one row per axis.
    expect(report).toContain('| Axis | Score | Read |');
    expect(report).toContain('| CV match | 4.0 | strong |');
    expect(report).toContain('| Geo | 4.5 | remote |');

    // Signal + watch-out are data-callouts, not blockquotes.
    expect(report).toContain('<div data-callout data-variant="success" data-emoji="✅">');
    expect(report).toContain('three years of pre-sales SE motion');
    expect(report).toContain('<div data-callout data-variant="warn" data-emoji="⚠️">');
    expect(report).toContain('the JD asks for 6+ years');
    expect(report).not.toMatch(/^> [✅⚠️]/m);

    // Header fields: seniority + archetype + derived logo are set.
    expect(report).toContain('seniority: Mid');
    expect(report).toContain('archetype: AI Solutions Engineer');
    expect(report).toContain(
      'company_logo: https://www.google.com/s2/favicons?domain=acme.com&sz=128',
    );

    // Still only the TL;DR section, no Role summary / Gaps / Snapshot.
    expect(report).not.toContain('## Role summary');
    expect(report).not.toContain('### Gaps');
    expect(report).not.toContain('## Snapshot');
    // 10 cols since the optional trailing `posted` column (empty when unknown).
    expect(tsv.split('\t')).toHaveLength(10);
  });

  it('carries a captured company_logo into frontmatter, overriding the favicon fallback', () => {
    const logo = 'https://media.licdn.com/dms/image/acme-logo.png';
    const { report } = buildScreenReport({ ...readable, company_logo: logo }, 3);
    expect(report).toContain(`company_logo: ${logo}`);
    expect(report).not.toContain('s2/favicons?domain=acme.com');
  });

  it('uses the worker-provided next_steps when present (role-specific, not the template)', () => {
    const { report } = buildScreenReport(
      { ...readable, next_steps: 'Reach out to the hiring manager before applying.' },
      3,
    );
    expect(report).toContain('**Next Steps** Reach out to the hiring manager before applying.');
    expect(report).not.toContain('Run a full evaluation to decide whether to pursue.');
  });

  it('marks below-threshold as Discarded with a Skip Next Steps', () => {
    const { report } = buildScreenReport({ ...readable, score: 1.0 }, 3);
    expect(report).toContain('status: Discarded');
    expect(report).toMatch(/\*\*Next Steps\*\* Skip/);
  });

  it('maps an unreadable page to Discarded with N/A score, a re-screen Next Steps, no table', () => {
    const { report, tsv } = buildScreenReport({ ...base, readable: false }, 3);
    expect(report).toContain('status: Discarded');
    expect(report).toContain('score: N/A');
    expect(report).toContain('\n## TL;DR\n');
    expect(report).toMatch(/\*\*Next Steps\*\* Re-screen/);
    expect(report.toLowerCase()).toContain('could not be read');
    expect(report).not.toContain('| Axis | Score | Read |');
    const cols = tsv.split('\t');
    expect(cols[4]).toBe('N/A');
    expect(cols[5]).toBe('Discarded');
  });

  it('treats Unknown company + no score as unreadable (Discarded)', () => {
    const { report } = buildScreenReport({ ...base, company: '', score: null }, 3);
    expect(report).toContain('status: Discarded');
    expect(report).toContain('score: N/A');
  });

  it('discardReason forces Discarded (prefilter) with the reason in TL;DR + Next Steps, no table', () => {
    const { report, tsv } = buildScreenReport(
      {
        ...base,
        readable: true,
        company: 'Acme',
        role: 'SE',
        discardReason: 'Prefiltered: geo blocker',
      },
      0,
    );
    expect(report).toContain('status: Discarded');
    expect(report).toContain('Prefiltered: geo blocker');
    expect(report).not.toContain('****');
    expect(report).not.toContain('| Axis | Score | Read |');
    expect(tsv.split('\t')[8]).toContain('geo blocker');
  });
});
