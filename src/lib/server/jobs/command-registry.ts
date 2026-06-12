// src/lib/server/jobs/command-registry.ts
//
// Build the shell command for a given job type (buildCommand) and guess a
// company slug from a job-board URL (guessCompanyFromURL).
//
// This is the command-registry slice — no spawn, no persistence, no CRUD.
// Inlined from src/server/lib/jobs.mjs.

import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { JobCommand, JobType } from '../../schemas/jobs';

/**
 * Best-effort guess of a company slug from a job-board URL. Used by the
 * screener for output filenames; the LLM still writes the canonical
 * company name into report content.
 */
export function guessCompanyFromURL(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    // boards.greenhouse.io/<company>/jobs/...   |   job-boards.greenhouse.io/<company>/jobs/...
    if (host.endsWith('greenhouse.io')) {
      const m = path.match(/^\/([^/]+)\/jobs\//);
      if (m) return m[1];
    }
    // jobs.lever.co/<company>/...   |   <company>.lever.co
    if (host.endsWith('lever.co')) {
      const m = path.match(/^\/([^/]+)\//);
      if (m) return m[1];
      const sub = host.split('.')[0];
      if (sub && sub !== 'jobs' && sub !== 'www') return sub;
    }
    // jobs.ashbyhq.com/<company>/...
    if (host.endsWith('ashbyhq.com')) {
      const m = path.match(/^\/([^/]+)\//);
      if (m) return m[1];
    }
    // <company>.wd1.myworkdayjobs.com/...   |   <company>.myworkdayjobs.com/...
    if (host.endsWith('myworkdayjobs.com')) {
      const sub = host.split('.')[0];
      if (sub) return sub;
    }
    // Fallback: registrable hostname minus TLD (e.g. "example.com" → "example")
    const parts = host.split('.').filter(p => p && p !== 'www' && p !== 'jobs' && p !== 'careers');
    if (parts.length >= 2) return parts[parts.length - 2];
    return parts[0] || '';
  } catch {
    return '';
  }
}

/**
 * Build the shell command for a given job type. Returns the validated
 * { cmd, args } pair, or null when `type` is not a known JobType, params
 * are invalid, or required inputs (e.g. a referenced applications row)
 * are missing.
 */
export function buildCommand(
  type: string,
  params: Record<string, unknown> | null | undefined,
  rootPath: string,
): import('../../schemas/jobs').JobCommand | null {
  const parsedType = JobType.safeParse(type);
  if (!parsedType.success) return null;
  const built = _buildCommand(parsedType.data, params, rootPath);
  if (built == null) return null;
  return JobCommand.parse(built);
}

// Internal implementation — accepts a validated JobType.
function _buildCommand(
  type: JobType,
  params: Record<string, unknown> | null | undefined,
  rootPath: string,
): { cmd: string; args: string[] } | null {
  if (type === 'scan') {
    // Both scanners run unconditionally and self-gate on
    // scanning.sources.{ats,jobspy}: scan-portals.mjs hits ATS feeds (zero
    // tokens), scan-jobspy.mjs scrapes public boards. A disabled or empty
    // source no-ops without failing the chain. Then screen + merge as before.
    return {
      cmd: '/bin/bash',
      args: [
        '-c',
        'node batch/scan-portals.mjs && node batch/scan-jobspy.mjs && node batch/screen.mjs && node cli/merge-tracker.mjs',
      ],
    };
  }
  if (type === 'batch-evaluate') {
    // Two-stage cost-optimized bulk evaluator. Stage 1: cheap Haiku screen on
    // every pending URL (skips already-screened ones). Stage 2: full Sonnet
    // evaluation only on survivors above the score threshold. Then merge.
    const parallel = Number.isInteger(params?.parallel) ? (params?.parallel as number) : 4;
    // Read threshold from config.yml unless the caller explicitly overrode it.
    let minScore: number | null = Number.isFinite(params?.min_score)
      ? (params?.min_score as number)
      : null;
    if (minScore == null) {
      try {
        const cfgPath = join(rootPath, 'inputs/config/config.yml');
        if (existsSync(cfgPath)) {
          const cfg = (yaml.load(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>) || {};
          const advanced = cfg.advanced as Record<string, unknown> | undefined;
          const v = advanced?.score_threshold;
          minScore = Number.isFinite(v) ? Number(v) : 3;
        } else {
          minScore = 3;
        }
      } catch {
        minScore = 3;
      }
    }
    return {
      cmd: '/bin/bash',
      args: [
        '-c',
        [
          'set -o pipefail',
          'printf "[1/4] Refreshing batch-input.tsv from pipeline.md\\n"',
          'node batch/pipeline-to-input.mjs',
          'printf "[2/4] Running screen pass (Haiku)\\n"',
          'node batch/screen.mjs',
          `printf "[3/4] Running full evaluation on screen survivors (Sonnet, parallel=${parallel}, min-score=${minScore})\\n"`,
          `./batch/batch-runner.sh --respect-screening --parallel ${parallel} --min-score ${minScore}`,
          'printf "[4/4] Merging results into tracker\\n"',
          'node cli/merge-tracker.mjs --force',
        ].join(' && '),
      ],
    };
  }
  if (type === 'screen') {
    const url = params && params.url;
    // Queue mode (no url): screen EVERY pending pipeline entry, then merge.
    // The scan chain minus the jobspy crawl — used for re-screens of
    // fetch-failed offers and ad-hoc sweeps, visible in the deck like any job.
    if (url == null) {
      return {
        cmd: '/bin/bash',
        args: ['-c', 'node batch/screen.mjs && node cli/merge-tracker.mjs'],
      };
    }
    if (typeof url !== 'string') return null;
    if (!/^https?:\/\//.test(url)) return null;
    const safeUrl = new URL(url).href.replace(/[\x00-\x1f`"$\\]/g, '');
    const company = guessCompanyFromURL(url).replace(/[\x00-\x1f`"$\\|]/g, '');
    // add-to-pipeline.mjs inserts the entry under `## Pending` (creating the
    // section if missing) and clears any stale dedup state, so the screener
    // actually re-processes the URL. The old inline `>> data/pipeline.md`
    // append put the line at EOF — after `## Processed` in a well-formed file —
    // where loadPending() never saw it, so screening silently no-op'd with a
    // misleading "already screened" toast. Args are passed positionally (not
    // interpolated into the bash string) so the URL/company can't break out.
    return {
      cmd: '/bin/bash',
      args: [
        '-c',
        // --url scopes the screener to just this offer so adding one URL doesn't
        // sweep in every other pending entry in the queue.
        'node batch/add-to-pipeline.mjs "$1" "$2" && node batch/screen.mjs --url "$1" && node cli/merge-tracker.mjs --force',
        'bash',
        safeUrl,
        company,
      ],
    };
  }
  if (type === 'screen-evaluate') {
    // Single-URL "add + full evaluation" chain. Screening must finish first:
    // evaluate needs the tracker num, which only exists after screen.mjs
    // writes the report and merge-tracker inserts the row. num-by-url then
    // resolves the new row from the report frontmatter (the tracker table
    // itself doesn't store URLs). URL/company are positional bash args —
    // same injection-safety pattern as 'screen' above.
    const url = params && params.url;
    if (!url || typeof url !== 'string') return null;
    if (!/^https?:\/\//.test(url)) return null;
    const safeUrl = new URL(url).href.replace(/[\x00-\x1f`"$\\]/g, '');
    const company = guessCompanyFromURL(url).replace(/[\x00-\x1f`"$\\|]/g, '');
    // Optional generators run between evaluate and the final merge so the
    // PDFs exist when the row is finalized. With two independent flags the
    // chain composes dynamically (3 base steps + 0-2 generator steps).
    const generators: Array<[string, string]> = [];
    if (params?.generate_pdf === true) generators.push(['Generating tailored CV PDF', 'tailor-cv']);
    if (params?.generate_cover_letter === true)
      generators.push(['Generating cover letter PDF', 'cover-letter']);
    const total = 4 + generators.length;
    let step = 0;
    const next = () => `[${++step}/${total}]`;
    const lines = [
      'set -o pipefail',
      `printf "${next()} Adding the offer to the pipeline\\n"`,
      'node batch/add-to-pipeline.mjs "$1" "$2"',
      `printf "${next()} Screening the posting\\n"`,
      'node batch/screen.mjs --url "$1"',
      'node cli/merge-tracker.mjs --force',
      'NUM=$(node cli/num-by-url.mjs "$1")',
      `printf "${next()} Running full evaluation for offer #%s (this can take ~10 min)\\n" "$NUM"`,
      'node batch/mode-runner.mjs evaluate --num "$NUM"',
    ];
    for (const [label, mode] of generators) {
      lines.push(`printf "${next()} ${label} for offer #%s\\n" "$NUM"`);
      lines.push(`node batch/mode-runner.mjs ${mode} --num "$NUM"`);
    }
    lines.push(`printf "${next()} Merging the new report into the tracker\\n"`);
    lines.push('node cli/merge-tracker.mjs --re-eval="$NUM"');
    return { cmd: '/bin/bash', args: ['-c', lines.join(' && '), 'bash', safeUrl, company] };
  }
  if (type === 'evaluate') {
    const num = params && params.num;
    if (!Number.isInteger(num)) return null;
    // The mode-runner owns input loading (tracker row, report, CV/profile,
    // JD fetch), prompt assembly, provider spawn, output parsing, and
    // artifact writes. Per-run platform/model overrides reach it via the
    // SUR9E_OVERRIDE_* env that runner.ts already sets from params.
    // Optional generators run between evaluate and the final merge so the
    // PDFs exist when the row is finalized. The chain composes dynamically:
    // evaluate → [tailor-cv] → [cover-letter] → merge-tracker → done.
    const generators: Array<[string, string]> = [];
    if (params?.generate_pdf === true) generators.push(['Generating tailored CV PDF', 'tailor-cv']);
    if (params?.generate_cover_letter === true)
      generators.push(['Generating cover letter PDF', 'cover-letter']);
    const total = 3 + generators.length;
    let step = 0;
    const next = () => `[${++step}/${total}]`;
    const lines = [
      `set -o pipefail`,
      `printf "${next()} Running full evaluation for offer #${num} (this can take ~10 min)\\n"`,
      `node batch/mode-runner.mjs evaluate --num ${num}`,
    ];
    for (const [label, mode] of generators) {
      lines.push(`printf "${next()} ${label} for offer #${num}\\n"`);
      lines.push(`node batch/mode-runner.mjs ${mode} --num ${num}`);
    }
    lines.push(
      `printf "${next()} Merging the new report into the tracker (re-eval mode, num=${num})\\n"`,
    );
    lines.push(`node cli/merge-tracker.mjs --re-eval=${num}`);
    lines.push(`printf "${next()} Done\\n"`);
    return { cmd: '/bin/bash', args: ['-c', lines.join(' && ')] };
  }
  if (
    type === 'research' ||
    type === 'interview-prep' ||
    type === 'reach-out' ||
    type === 'negotiate'
  ) {
    const num = params && params.num;
    if (!Number.isInteger(num)) return null;
    const STAGE: Record<string, string> = {
      research: 'company research',
      'interview-prep': 'interview process intel',
      'reach-out': 'outreach research',
      negotiate: 'negotiation strategy',
    };
    const script = [
      `set -o pipefail`,
      `printf "[1/2] Running ${STAGE[type]} for offer #${num} (streaming live)\\n"`,
      `node batch/mode-runner.mjs ${type} --num ${num}`,
      `printf "[2/2] Done\\n"`,
    ].join(' && ');
    return { cmd: '/bin/bash', args: ['-c', script] };
  }
  if (type === 'tailor-cv' || type === 'cover-letter') {
    const num = params && params.num;
    if (!Number.isInteger(num)) return null;
    const label = type === 'tailor-cv' ? 'tailored CV' : 'cover letter';
    const script = [
      `set -o pipefail`,
      `printf "[1/2] Generating ${label} for offer #${num}\\n"`,
      `node batch/mode-runner.mjs ${type} --num ${num}`,
      `printf "[2/2] Done\\n"`,
    ].join(' && ');
    return { cmd: '/bin/bash', args: ['-c', script] };
  }
  return null;
}

export type { JobCommand, JobType } from '../../schemas/jobs';
