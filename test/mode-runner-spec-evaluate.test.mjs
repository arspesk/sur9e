// test/mode-runner-spec-evaluate.test.mjs
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseReportFile } from '../batch/lib/report-file.mjs';
import evaluateSpec from '../batch/specs/evaluate.mjs';

// loadInputs fetches the offer URL for the JD. Never hit the live network from
// a unit test — the fixture URL (acme.com) hung past the 5s test timeout on CI.
vi.mock('../batch/jd-fetcher.mjs', () => ({
  fetchJobDescription: vi.fn(async () => ({
    text: 'MOCK JD TEXT',
    status: 'ok',
    httpStatus: 200,
  })),
}));

const MODEL_REPORT = `---
company: Acme
role: Solutions Engineer
archetype: Pre-Sales SE
seniority: Mid
location: Los Angeles
work_mode: Remote
comp: $140K-$160K
date: 2026-05-20
posted: 2026-05-18
url: https://model-invented.example/IGNORE-ME
company_logo: https://www.google.com/s2/favicons?domain=acme.com&sz=128
score: 4.2
legitimacy: high_confidence
score_breakdown:
  cv_match: 4.6
  seniority: 3.1
  compensation: 4.4
  domain: 4.2
  geo: 5.0
  legitimacy: 4.5
---

<div data-callout data-variant="success" data-emoji="✅">

**Next Steps** Apply now.

</div>

## TL;DR

**Strong archetype fit**, comp inside band.
`;

let root;
let ctx;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eval-spec-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
  mkdirSync(join(root, 'batch/tracker-additions'), { recursive: true });
  mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
  mkdirSync(join(root, 'content/modes'), { recursive: true });
  writeFileSync(join(root, 'inputs/personalization/cv.md'), '# CV', 'utf-8');
  writeFileSync(join(root, 'inputs/personalization/profile.yml'), 'name: Test', 'utf-8');
  writeFileSync(join(root, 'content/modes/evaluate.md'), '# Mode: evaluate', 'utf-8');
  writeFileSync(join(root, 'content/modes/_shared.md'), '# shared', 'utf-8');
  writeFileSync(
    join(root, 'data/applications.md'),
    '| 7 | 2026-06-01 | Acme | SE | 3.8/5 | Screened | ❌ | [7](artifacts/reports/007-acme-2026-06-01.md) | screened |',
    'utf-8',
  );
  writeFileSync(
    join(root, 'artifacts/reports/007-acme-2026-06-01.md'),
    '---\nnum: 7\ncompany: Acme\nurl: https://acme.com/jobs/1\nscore: 3.8\n---\n\n## TL;DR\n\nold\n',
    'utf-8',
  );
  ctx = { rootPath: root, num: 7 };
});

describe('evaluate spec', () => {
  it('parse extracts the sentinel payload and validates frontmatter', () => {
    const out = evaluateSpec.parse(`prose\n<<<SUR9E_OUTPUT>>>\n${MODEL_REPORT}\n<<<SUR9E_END>>>`);
    expect(out.frontmatter.company).toBe('Acme');
    expect(out.body).toContain('## TL;DR');
  });

  it('parse rejects a payload missing score_breakdown axes', () => {
    const bad = MODEL_REPORT.replace(/score_breakdown:[\s\S]*?legitimacy: 4.5\n/, '');
    expect(() => evaluateSpec.parse(`<<<SUR9E_OUTPUT>>>\n${bad}\n<<<SUR9E_END>>>`)).toThrow(
      /score_breakdown/,
    );
  });

  it('write overwrites the existing report path with Node-owned fields forced', async () => {
    const inputs = await evaluateSpec.loadInputs(ctx);
    const payload = evaluateSpec.parse(`<<<SUR9E_OUTPUT>>>\n${MODEL_REPORT}\n<<<SUR9E_END>>>`);
    await evaluateSpec.write(ctx, inputs, payload);

    const raw = readFileSync(join(root, 'artifacts/reports/007-acme-2026-06-01.md'), 'utf-8');
    const { frontmatter, body } = parseReportFile(raw);
    expect(frontmatter.num).toBe(7);
    expect(frontmatter.status).toBe('Evaluated');
    expect(frontmatter.state).toBe('evaluated');
    expect(frontmatter.url).toBe('https://acme.com/jobs/1'); // tracker URL, not the model's
    expect(frontmatter.score).toBe(4.2);
    // `date` is Node-owned (the evaluation date) — the model's 2026-05-20
    // must NOT survive; the posting date routes into `posted` instead.
    expect(frontmatter.date).toBe(new Date().toISOString().slice(0, 10));
    expect(frontmatter.posted).toBe('2026-05-18');
    expect(body).toContain('**Next Steps**');
  });

  it('write omits posted when the model leaves it out or emits garbage', async () => {
    const inputs = await evaluateSpec.loadInputs(ctx);
    const noPosted = MODEL_REPORT.replace('posted: 2026-05-18\n', 'posted: sometime in May\n');
    const payload = evaluateSpec.parse(`<<<SUR9E_OUTPUT>>>\n${noPosted}\n<<<SUR9E_END>>>`);
    await evaluateSpec.write(ctx, inputs, payload);

    const raw = readFileSync(join(root, 'artifacts/reports/007-acme-2026-06-01.md'), 'utf-8');
    const { frontmatter } = parseReportFile(raw);
    expect('posted' in frontmatter).toBe(false);
    // Strip only the newline — trimEnd would also eat the tab that delimits
    // the empty trailing posted cell.
    const tsv = readFileSync(join(root, 'batch/tracker-additions/007-acme.tsv'), 'utf-8');
    const cols = tsv.replace(/\n$/, '').split('\t');
    expect(cols).toHaveLength(10);
    expect(cols[9]).toBe('');
  });

  it('write emits the 10-col Evaluated tracker TSV with num=7 and posted last', async () => {
    const inputs = await evaluateSpec.loadInputs(ctx);
    const payload = evaluateSpec.parse(`<<<SUR9E_OUTPUT>>>\n${MODEL_REPORT}\n<<<SUR9E_END>>>`);
    await evaluateSpec.write(ctx, inputs, payload);

    const tsv = readFileSync(join(root, 'batch/tracker-additions/007-acme.tsv'), 'utf-8').trim();
    const cols = tsv.split('\t');
    expect(cols).toHaveLength(10);
    expect(cols[0]).toBe('7');
    expect(cols[2]).toBe('Acme');
    expect(cols[4]).toBe('4.2/5');
    expect(cols[5]).toBe('Evaluated');
    expect(cols[7]).toBe('[7](artifacts/reports/007-acme-2026-06-01.md)');
    expect(cols[9]).toBe('2026-05-18');
  });

  it('buildPrompt inlines mode body, shared contract, CV, profile, JD and the sentinel instruction', async () => {
    const inputs = await evaluateSpec.loadInputs(ctx);
    inputs.jd = { text: 'JD TEXT', status: 'ok' };
    const prompt = evaluateSpec.buildPrompt(ctx, inputs);
    expect(prompt).toContain('# Mode: evaluate');
    expect(prompt).toContain('# shared');
    expect(prompt).toContain('# CV');
    expect(prompt).toContain('JD TEXT');
    expect(prompt).toContain('<<<SUR9E_OUTPUT>>>');
  });
});

describe('evaluate write() — graft preserved sections', () => {
  // Existing report has real Company Research and Interview Process sections
  // written by /research and /interview-prep respectively.
  const EXISTING_REPORT_WITH_SECTIONS = `---
num: 7
company: Acme
url: https://acme.com/jobs/1
score: 3.8
---

## TL;DR

old verdict

## Company Research

Real company research findings appended by /research.

### Funding

Series B, $50M raised.

## Interview Process

Real interview process notes appended by /interview-prep.
`;

  // The model's stub body for Company Research and Interview Process —
  // evaluate.md instructs the model to emit the canonical ## heading with
  // a one-line pointer, so upsertSection can locate and replace the stub.
  const MODEL_REPORT_WITH_STUBS = `---
company: Acme
role: Solutions Engineer
archetype: Pre-Sales SE
seniority: Mid
location: Los Angeles
work_mode: Remote
comp: $140K-$160K
date: 2026-05-20
url: https://model-invented.example/IGNORE-ME
company_logo: https://www.google.com/s2/favicons?domain=acme.com&sz=128
score: 4.5
legitimacy: high_confidence
score_breakdown:
  cv_match: 4.6
  seniority: 3.1
  compensation: 4.4
  domain: 4.2
  geo: 5.0
  legitimacy: 4.5
---

<div data-callout data-variant="success" data-emoji="✅">

**Next Steps** Apply now.

</div>

## TL;DR

New verdict after re-evaluation.

## Company Research

Run /research for the candidate angle and reference axes.

## Interview Process

Run /interview-prep for interview process details.
`;

  it('re-evaluate grafts existing mode-owned sections back over model stubs', async () => {
    // Seed the existing report with real section content
    writeFileSync(
      join(root, 'artifacts/reports/007-acme-2026-06-01.md'),
      EXISTING_REPORT_WITH_SECTIONS,
      'utf-8',
    );
    const inputs = await evaluateSpec.loadInputs(ctx);
    const payload = evaluateSpec.parse(
      `<<<SUR9E_OUTPUT>>>\n${MODEL_REPORT_WITH_STUBS}\n<<<SUR9E_END>>>`,
    );
    await evaluateSpec.write(ctx, inputs, payload);

    const raw = readFileSync(join(root, 'artifacts/reports/007-acme-2026-06-01.md'), 'utf-8');
    const { body } = parseReportFile(raw);

    // The new TL;DR from the model must be present
    expect(body).toContain('New verdict after re-evaluation.');

    // The real Company Research must replace the stub
    expect(body).toContain('Real company research findings appended by /research.');
    expect(body).toContain('### Funding');
    expect(body).toContain('Series B, $50M raised.');
    // The stub one-liner must not survive
    expect(body).not.toContain('Run /research for the candidate angle');

    // The real Interview Process must replace the stub
    expect(body).toContain('Real interview process notes appended by /interview-prep.');
    expect(body).not.toContain('Run /interview-prep for interview process details.');
  });

  it('first evaluate (existing file has no mode-owned sections) writes stubs as-is, no phantom content', async () => {
    // Seed the report with only base content — no mode-owned sections present yet.
    writeFileSync(
      join(root, 'artifacts/reports/007-acme-2026-06-01.md'),
      '---\nnum: 7\ncompany: Acme\nurl: https://acme.com/jobs/1\nscore: 3.8\n---\n\n## TL;DR\n\nold\n',
      'utf-8',
    );
    const inputs = await evaluateSpec.loadInputs(ctx);
    const payload = evaluateSpec.parse(
      `<<<SUR9E_OUTPUT>>>\n${MODEL_REPORT_WITH_STUBS}\n<<<SUR9E_END>>>`,
    );
    await evaluateSpec.write(ctx, inputs, payload);

    const raw = readFileSync(join(root, 'artifacts/reports/007-acme-2026-06-01.md'), 'utf-8');
    const { body } = parseReportFile(raw);
    // The model's stubs are written as-is — no phantom content injected
    expect(body).toContain('Run /research for the candidate angle');
    expect(body).toContain('New verdict after re-evaluation.');
    // No real research content should be present (there was none to preserve)
    expect(body).not.toContain('Real company research findings');
  });
});

describe('identity guard', () => {
  it('accepts refinements of the tracker company name', async () => {
    const { companiesMatch } = await import('../batch/specs/evaluate.mjs');
    expect(companiesMatch('Anduril Industries', 'Anduril')).toBe(true);
    expect(companiesMatch('Otter', 'Otter.ai')).toBe(true);
    expect(companiesMatch('PwC', 'PwC US')).toBe(true);
    expect(companiesMatch('Unknown', 'Anything Inc')).toBe(true);
  });

  it('write refuses a disjoint company (the agy W&B-onto-Sift hallucination)', async () => {
    const inputs = await evaluateSpec.loadInputs(ctx);
    const wrongCompany = MODEL_REPORT.replace('company: Acme', 'company: Weights & Biases');
    const payload = evaluateSpec.parse(`<<<SUR9E_OUTPUT>>>\n${wrongCompany}\n<<<SUR9E_END>>>`);
    await expect(evaluateSpec.write(ctx, inputs, payload)).rejects.toThrow(/identity mismatch/);
    // nothing was written
    const raw = readFileSync(join(root, 'artifacts/reports/007-acme-2026-06-01.md'), 'utf-8');
    expect(raw).toContain('old');
    expect(raw).not.toContain('Weights');
  });
});
