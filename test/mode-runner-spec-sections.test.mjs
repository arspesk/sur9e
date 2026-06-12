// test/mode-runner-spec-sections.test.mjs
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  interviewPrepSpec,
  negotiateSpec,
  outreachSpec,
  researchSpec,
} from '../batch/specs/sections.mjs';

let root;
let ctx;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sections-spec-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
  mkdirSync(join(root, 'content/modes'), { recursive: true });
  writeFileSync(join(root, 'content/modes/_shared.md'), '# shared contract', 'utf-8');
  for (const f of ['research.md', 'interview-prep.md', 'reach-out.md', 'negotiate.md']) {
    writeFileSync(join(root, `content/modes/${f}`), `# Mode body for ${f}`, 'utf-8');
  }
  writeFileSync(
    join(root, 'data/applications.md'),
    '| 7 | 2026-06-01 | Acme | SE | 4.2/5 | Evaluated | ❌ | [7](artifacts/reports/007-acme-2026-06-01.md) | ok |',
    'utf-8',
  );
  writeFileSync(
    join(root, 'artifacts/reports/007-acme-2026-06-01.md'),
    '---\nnum: 7\ncompany: Acme\nurl: https://acme.com/jobs/1\nscore: 4.2\n---\n\n## TL;DR\n\nverdict\n',
    'utf-8',
  );
  ctx = { rootPath: root, num: 7 };
});

describe('section specs', () => {
  it.each([
    [researchSpec, 'research', 'Company Research'],
    [interviewPrepSpec, 'interview-prep', 'Interview Process'],
    [outreachSpec, 'reach-out', 'Outreach'],
    [negotiateSpec, 'negotiate', 'Negotiation Strategy'],
  ])('%# %s spec appends its exact H2 title', async (spec, modeId, title) => {
    expect(spec.modeId).toBe(modeId);
    const inputs = await spec.loadInputs(ctx);
    const payload = spec.parse(
      `prose\n<<<SUR9E_OUTPUT>>>\n## ${title}\n\nfindings here\n<<<SUR9E_END>>>`,
    );
    await spec.write(ctx, inputs, payload);
    const raw = readFileSync(join(root, 'artifacts/reports/007-acme-2026-06-01.md'), 'utf-8');
    expect(raw).toContain(`## ${title}`);
    expect(raw).toContain('findings here');
    expect(raw).toContain('## TL;DR'); // existing body intact
    expect(raw.startsWith('---\n')).toBe(true); // frontmatter intact
  });

  it('parse rejects a payload whose heading is wrong', () => {
    expect(() =>
      researchSpec.parse('<<<SUR9E_OUTPUT>>>\n## Wrong Title\n\nx\n<<<SUR9E_END>>>'),
    ).toThrow(/Company Research/);
  });

  it('re-running replaces the existing section instead of duplicating it', async () => {
    const inputs = await researchSpec.loadInputs(ctx);
    const p1 = researchSpec.parse('<<<SUR9E_OUTPUT>>>\n## Company Research\n\nv1\n<<<SUR9E_END>>>');
    await researchSpec.write(ctx, inputs, p1);
    const p2 = researchSpec.parse('<<<SUR9E_OUTPUT>>>\n## Company Research\n\nv2\n<<<SUR9E_END>>>');
    await researchSpec.write(ctx, inputs, p2);
    const raw = readFileSync(join(root, 'artifacts/reports/007-acme-2026-06-01.md'), 'utf-8');
    expect(raw).not.toContain('v1');
    expect(raw).toContain('v2');
    expect(raw.match(/^## Company Research$/gm)).toHaveLength(1);
  });

  it('buildPrompt inlines the mode body, shared contract, report context and sentinel instruction', async () => {
    const inputs = await researchSpec.loadInputs(ctx);
    const prompt = researchSpec.buildPrompt(ctx, inputs);
    expect(prompt).toContain('# Mode body for research.md');
    expect(prompt).toContain('# shared contract');
    expect(prompt).toContain('verdict'); // existing report body for context
    expect(prompt).toContain('<<<SUR9E_OUTPUT>>>');
    expect(prompt).toContain('## Company Research');
  });

  it('optional leading Next Steps callout is split off and replaces the report leading callout', async () => {
    // Seed the report with an existing leading callout (the report contract's
    // first body block) so the refresh path REPLACES rather than stacks.
    writeFileSync(
      join(root, 'artifacts/reports/007-acme-2026-06-01.md'),
      '---\nnum: 7\ncompany: Acme\nurl: https://acme.com/jobs/1\nscore: 4.2\n---\n\n<div data-callout data-variant="info" data-emoji="💡">\n\n**Next Steps** Run a full evaluation.\n\n</div>\n\n## TL;DR\n\nverdict\n',
      'utf-8',
    );
    const inputs = await researchSpec.loadInputs(ctx);
    const newCallout =
      '<div data-callout data-variant="error" data-emoji="🛑">**Next Steps** Skip — hiring freeze found.</div>';
    const payload = researchSpec.parse(
      `<<<SUR9E_OUTPUT>>>\n${newCallout}\n\n## Company Research\n\nfreeze details\n<<<SUR9E_END>>>`,
    );
    // parse() normalizes the callout to the blank-line-padded form so
    // markdown inside the HTML block renders (single-line shows literal **).
    expect(payload.callout).toBe(
      '<div data-callout data-variant="error" data-emoji="\u{1F6D1}">\n\n**Next Steps** Skip — hiring freeze found.\n\n</div>',
    );
    expect(payload.section.startsWith('## Company Research')).toBe(true);
    const { summary } = await researchSpec.write(ctx, inputs, payload);
    expect(summary).toContain('Next Steps callout refreshed');

    const raw = readFileSync(join(root, 'artifacts/reports/007-acme-2026-06-01.md'), 'utf-8');
    expect(raw).toContain('hiring freeze found');
    expect(raw).not.toContain('Run a full evaluation.'); // old callout replaced
    expect(raw).toContain('## Company Research');
    // exactly one callout before ## TL;DR
    const beforeTldr = raw.slice(0, raw.indexOf('## TL;DR'));
    expect(beforeTldr.match(/data-callout/g)).toHaveLength(1);
  });

  it('payload without a callout leaves the existing leading callout untouched', async () => {
    writeFileSync(
      join(root, 'artifacts/reports/007-acme-2026-06-01.md'),
      '---\nnum: 7\ncompany: Acme\nurl: https://acme.com/jobs/1\nscore: 4.2\n---\n\n<div data-callout data-variant="info" data-emoji="💡">\n\n**Next Steps** Run a full evaluation.\n\n</div>\n\n## TL;DR\n\nverdict\n',
      'utf-8',
    );
    const inputs = await researchSpec.loadInputs(ctx);
    const payload = researchSpec.parse(
      '<<<SUR9E_OUTPUT>>>\n## Company Research\n\nplain findings\n<<<SUR9E_END>>>',
    );
    expect(payload.callout).toBeNull();
    await researchSpec.write(ctx, inputs, payload);
    const raw = readFileSync(join(root, 'artifacts/reports/007-acme-2026-06-01.md'), 'utf-8');
    expect(raw).toContain('Run a full evaluation.'); // untouched
    expect(raw).toContain('plain findings');
  });
});
