// test/mode-runner-report-file.test.mjs
import { describe, expect, it } from 'vitest';
import {
  extractNamedSections,
  padCallouts,
  parseReportFile,
  serializeReportFile,
  stripFrontMatter,
  upsertSection,
} from '../batch/lib/report-file.mjs';

const SAMPLE = `---
num: 7
company: Acme
score: 4.2
---

## TL;DR

verdict here
`;

describe('parseReportFile', () => {
  it('splits frontmatter object and body', () => {
    const { frontmatter, body } = parseReportFile(SAMPLE);
    expect(frontmatter.num).toBe(7);
    expect(frontmatter.company).toBe('Acme');
    expect(body).toContain('## TL;DR');
    expect(body).not.toContain('company: Acme');
  });

  it('throws on a legacy (non-frontmatter) file', () => {
    expect(() => parseReportFile('# Screening: Acme')).toThrow(/frontmatter/i);
  });
});

describe('serializeReportFile', () => {
  it('round-trips parse → serialize', () => {
    const { frontmatter, body } = parseReportFile(SAMPLE);
    const out = serializeReportFile(frontmatter, body);
    const again = parseReportFile(out);
    expect(again.frontmatter).toEqual(frontmatter);
    expect(again.body.trim()).toBe(body.trim());
  });
});

describe('upsertSection', () => {
  const body = `## TL;DR\n\nverdict\n\n## Compensation\n\ncomp text\n`;

  it('appends a new H2 section at the end', () => {
    const next = upsertSection(body, 'Company Research', '## Company Research\n\nfindings');
    expect(next.trim().endsWith('findings')).toBe(true);
    expect(next).toContain('## Compensation'); // untouched
  });

  it('replaces an existing same-title H2 section in place', () => {
    const withSection = upsertSection(body, 'Company Research', '## Company Research\n\nv1');
    const replaced = upsertSection(withSection, 'Company Research', '## Company Research\n\nv2');
    expect(replaced).toContain('v2');
    expect(replaced).not.toContain('v1');
    // still exactly one occurrence of the heading
    expect(replaced.match(/^## Company Research$/gm)).toHaveLength(1);
  });

  it('replacement stops at the next H2, not at H3 subsections', () => {
    const withSub = upsertSection(
      body,
      'Company Research',
      '## Company Research\n\nintro\n\n### Funding\n\nseries B',
    );
    const replaced = upsertSection(withSub, 'Company Research', '## Company Research\n\nnew');
    expect(replaced).not.toContain('series B');
    expect(replaced).toContain('## Compensation');
  });
});

describe('extractNamedSections', () => {
  const BODY = [
    '## TL;DR',
    '',
    'verdict',
    '',
    '## Company Research',
    '',
    'research findings',
    '### Funding',
    '',
    'series B',
    '',
    '## Outreach',
    '',
    'outreach text',
    '',
    '## Interview Process',
    '',
    'interview notes',
  ].join('\n');

  it('returns sections in the order of the titles argument, not file order', () => {
    const result = extractNamedSections(BODY, ['Outreach', 'Company Research']);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Outreach');
    expect(result[1].title).toBe('Company Research');
  });

  it('each sectionMarkdown includes the ## heading and body up to next ##', () => {
    const [{ sectionMarkdown }] = extractNamedSections(BODY, ['Company Research']);
    expect(sectionMarkdown).toContain('## Company Research');
    expect(sectionMarkdown).toContain('research findings');
    expect(sectionMarkdown).toContain('### Funding');
    expect(sectionMarkdown).toContain('series B');
    // must not bleed into next H2
    expect(sectionMarkdown).not.toContain('## Outreach');
  });

  it('silently omits titles that are not present in the body', () => {
    const result = extractNamedSections(BODY, ['Negotiation Strategy', 'Outreach']);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Outreach');
  });

  it('captures an EOF section (no trailing ## boundary)', () => {
    const [{ sectionMarkdown }] = extractNamedSections(BODY, ['Interview Process']);
    expect(sectionMarkdown).toContain('## Interview Process');
    expect(sectionMarkdown).toContain('interview notes');
  });

  it('returns an empty array when no titles match', () => {
    expect(extractNamedSections(BODY, ['Missing One', 'Missing Two'])).toHaveLength(0);
  });
});

describe('stripFrontMatter', () => {
  it('strips a leading mode-manifest block', () => {
    const text = '---\nexec: headless\n---\n\n# Mode body\n\nprompt text';
    expect(stripFrontMatter(text)).toBe('# Mode body\n\nprompt text');
  });

  it('returns text unchanged when there is no front-matter', () => {
    expect(stripFrontMatter('# Plain mode')).toBe('# Plain mode');
  });
});

describe('padCallouts', () => {
  it('pads a single-line callout so inner markdown renders', () => {
    const md =
      '<div data-callout data-variant="success" data-emoji="✅">**Next Steps** Apply now.</div>';
    expect(padCallouts(md)).toBe(
      '<div data-callout data-variant="success" data-emoji="✅">\n\n**Next Steps** Apply now.\n\n</div>',
    );
  });

  it('is idempotent on already-padded callouts', () => {
    const md =
      '<div data-callout data-variant="warn" data-emoji="⚠️">\n\n**Watch-out** travel.\n\n</div>';
    expect(padCallouts(padCallouts(md))).toBe(md);
  });

  it('pads every callout in a body, leaving other content alone', () => {
    const md =
      '## TL;DR\n\ntext\n\n<div data-callout a>**A**</div>\n\nmid\n\n<div data-callout b>**B**</div>';
    const out = padCallouts(md);
    expect(out.match(/data-callout/g)).toHaveLength(2);
    expect(out).toContain('<div data-callout a>\n\n**A**\n\n</div>');
    expect(out).toContain('<div data-callout b>\n\n**B**\n\n</div>');
    expect(out).toContain('## TL;DR');
  });
});
