import { describe, expect, it } from 'vitest';
import { addToPipeline, normalizeUrl } from '../batch/add-to-pipeline.mjs';

// Helper: parse the entries screen.mjs's loadPending() would actually screen
// (lines between `## Pending` and the next heading). Uses the EXACT field
// regex from batch/screen.mjs (url + optional company + optional title) so the
// assertions verify the real read path — including how each field binds, not
// just the URL.
function parsePending(pipelineText) {
  const m = pipelineText.match(/## Pending\s*\n([\s\S]*?)(?=\n## |\s*$)/);
  if (!m) return [];
  const offers = [];
  for (const line of m[1].split('\n')) {
    const lm = line.match(/^- \[ \] (\S+)(?: \| ([^|]+?))?(?: \| (.+))?$/);
    if (lm) offers.push({ url: lm[1], company: (lm[2] || '').trim(), title: (lm[3] || '').trim() });
  }
  return offers;
}
const loadPending = text => parsePending(text).map(o => o.url);

const URL = 'https://docmagic.bamboohr.com/careers/65';

describe('addToPipeline', () => {
  it('scaffolds ## Pending when the file is a flat list with no heading (the bug)', () => {
    const flat = `\n- [ ] https://example.com/a | acme | \n\n- [ ] ${URL} | bamboohr | \n`;
    const { pipeline } = addToPipeline({
      pipelineText: flat,
      screenedText: '',
      url: URL,
      company: 'bamboohr',
    });
    expect(pipeline).toContain('## Pending');
    expect(pipeline).toContain('## Processed');
    // Both the pre-existing flat entry and the re-queued URL are now screenable.
    expect(loadPending(pipeline)).toEqual(['https://example.com/a', URL]);
  });

  it('inserts under ## Pending, not at EOF after ## Processed', () => {
    const wellFormed = `# Pipeline Inbox\n\n## Pending\n- [ ] https://example.com/keep | acme | \n\n## Processed\n- [x] https://old.com/1 | old | \n`;
    const { pipeline } = addToPipeline({
      pipelineText: wellFormed,
      screenedText: '',
      url: URL,
      company: 'bamboohr',
    });
    // The new URL must be read by loadPending (i.e. live under ## Pending).
    expect(loadPending(pipeline)).toContain(URL);
    // ## Processed and its entry must survive untouched.
    expect(pipeline).toContain('- [x] https://old.com/1 | old |');
  });

  it('moves an already-processed URL back to Pending without duplicating it', () => {
    const processed = `# Pipeline Inbox\n\n## Pending\n\n## Processed\n- [x] ${URL} | bamboohr | \n`;
    const { pipeline } = addToPipeline({
      pipelineText: processed,
      screenedText: '',
      url: URL,
      company: 'bamboohr',
    });
    expect(loadPending(pipeline)).toEqual([URL]);
    // The stale `- [x]` line is gone — exactly one entry for the URL remains.
    const occurrences = pipeline.split(URL).length - 1;
    expect(occurrences).toBe(1);
  });

  it('clears the URL from screened-urls.txt dedup state, keeping others', () => {
    const screened = `https://other.com/1\n${URL}\nhttps://other.com/2\n`;
    const { screened: out } = addToPipeline({
      pipelineText: '',
      screenedText: screened,
      url: URL,
      company: 'bamboohr',
    });
    expect(out).toBe('https://other.com/1\nhttps://other.com/2\n');
  });

  it('queues company into the company field, NOT the title (the otter bug)', () => {
    // Regression: a `… | company | ` trailing-empty-title line made
    // loadPending's full regex bind the company slug into the *title* field,
    // and the metadata prefilter then discarded it as a non-matching job title
    // ("title does not match target search terms"). The queued line must parse
    // with company set and an EMPTY title so a bare URL is screened, not
    // prefiltered.
    const GH = 'https://job-boards.greenhouse.io/otter/jobs/8436361002';
    const { pipeline } = addToPipeline({
      pipelineText: '',
      screenedText: '',
      url: GH,
      company: 'otter',
    });
    const [offer] = parsePending(pipeline);
    expect(offer).toEqual({ url: GH, company: 'otter', title: '' });
  });

  it('normalizeUrl canonicalizes to href form', () => {
    expect(normalizeUrl('https://docmagic.bamboohr.com/careers/65')).toBe(URL);
    expect(() => normalizeUrl('not a url')).toThrow();
  });
});
