#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * add-to-pipeline.mjs — add a single URL to the screener's pending queue.
 *
 * Used by the user-driven "Screen this offer" flow (src/lib/server/jobs/
 * command-registry.ts → screen job). Replaces the old naive
 *   `printf … >> data/pipeline.md`
 * append, which had two bugs that made single-offer screening silently
 * no-op with a misleading "URL was already screened" toast:
 *
 *   1. A well-formed pipeline.md is `## Pending … ## Processed …`. Appending
 *      at EOF lands the new URL *after* `## Processed`, but screen.mjs's
 *      loadPending() only reads lines between `## Pending` and the next
 *      heading — so the URL was never seen.
 *   2. If pipeline.md had no `## Pending` heading at all (fresh install or a
 *      hand-edited/flat file), loadPending() returned nothing and screened
 *      zero URLs.
 *
 * The pure addToPipeline() below inserts the entry directly under `## Pending`
 * (creating the `# Pipeline Inbox / ## Pending / ## Processed` scaffold if
 * missing), mirrors batch/scan-jobspy.mjs's appendToPipeline() insertion logic,
 * and also clears prior dedup state so a re-screen actually re-processes the URL:
 *   - removes the URL from batch/screened-urls.txt (robustly — no grep exit-code
 *     quirk that left a stale screened-urls.txt.tmp behind), and
 *   - removes any existing `- [ ]`/`- [x]` line for the URL from pipeline.md so
 *     re-screening doesn't pile up duplicate entries.
 *
 * Usage:
 *   node batch/add-to-pipeline.mjs <url> [company]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PENDING_MARKER = '## Pending';

/**
 * Normalize a raw URL to its canonical href form (matching how screen.mjs and
 * the screen job compare URLs). Throws on an unparseable URL.
 */
export function normalizeUrl(raw) {
  return new URL(raw).href;
}

/**
 * Pure transform — exported for unit tests. Given the current text of
 * pipeline.md and screened-urls.txt (empty string when the file is absent),
 * returns the updated text for both, with `url` queued fresh under `## Pending`.
 *
 * @param {{ pipelineText: string, screenedText: string, url: string, company?: string }} input
 * @returns {{ pipeline: string, screened: string }}
 */
export function addToPipeline({ pipelineText, screenedText, url, company = '' }) {
  // 1. Drop the URL from screened-urls.txt dedup state so this run re-processes it.
  const keptScreened = (screenedText || '')
    .split('\n')
    .filter(line => line.trim() !== '' && line.trim() !== url);
  const screened = keptScreened.length ? `${keptScreened.join('\n')}\n` : '';

  // 2. Load (or scaffold) pipeline text. If it exists but has no `## Pending`
  //    heading (flat list / hand-edited), rebuild the canonical scaffold while
  //    preserving any existing `- [ ]`/`- [x]` task lines under `## Pending`.
  let text = pipelineText && pipelineText.trim() ? pipelineText : '# Pipeline Inbox\n\n## Pending\n\n## Processed\n';
  if (text.indexOf(PENDING_MARKER) === -1) {
    const existingTasks = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^- \[[ x]\] /.test(line));
    text = `# Pipeline Inbox\n\n## Pending\n${
      existingTasks.length ? `${existingTasks.join('\n')}\n` : ''
    }\n## Processed\n`;
  }

  // 3. Remove any existing line for this URL (both `- [ ]` and `- [x]`) so a
  //    re-screen produces exactly one fresh `- [ ]`, not a duplicate.
  const urlEscaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingLineRe = new RegExp(`^- \\[[ x]\\] ${urlEscaped}(?:\\s.*)?$\\n?`, 'gm');
  text = text.replace(existingLineRe, '');

  // 4. Insert the new entry under `## Pending` (before the next heading, or at EOF
  //    when Pending is the last section).
  // The line must round-trip through screen.mjs's loadPending() regex
  //   /^- \[ \] (\S+)(?: \| ([^|]+?))?(?: \| (.+))?$/
  // A trailing empty title (`… | company | `) makes that regex fail to bind the
  // company group and dump "company |" into the *title* field — which the
  // metadata prefilter then judges as a non-matching job title and discards
  // before the page is ever fetched. With only a company (no title), emit
  // `url | company` and stop (no trailing pipe) so company binds and title
  // stays empty.
  const line = company ? `- [ ] ${url} | ${company}` : `- [ ] ${url}`;
  const idx = text.indexOf(PENDING_MARKER);
  const nextHeading = text.indexOf('\n## ', idx + PENDING_MARKER.length);
  const insertAt = nextHeading === -1 ? text.length : nextHeading;
  text = `${text.slice(0, insertAt)}\n${line}\n${text.slice(insertAt)}`;

  return { pipeline: text, screened };
}

function main() {
  const ROOT = resolve(process.cwd());
  const PIPELINE = join(ROOT, 'data/pipeline.md');
  const SCREENED_URLS = join(ROOT, 'batch/screened-urls.txt');

  const rawUrl = process.argv[2];
  const company = (process.argv[3] || '').trim();
  if (!rawUrl) {
    console.error('add-to-pipeline: missing <url> argument');
    process.exit(1);
  }
  let url;
  try {
    url = normalizeUrl(rawUrl);
  } catch {
    console.error(`add-to-pipeline: invalid URL "${rawUrl}"`);
    process.exit(1);
  }

  const pipelineText = existsSync(PIPELINE) ? readFileSync(PIPELINE, 'utf-8') : '';
  const screenedText = existsSync(SCREENED_URLS) ? readFileSync(SCREENED_URLS, 'utf-8') : '';
  const { pipeline, screened } = addToPipeline({ pipelineText, screenedText, url, company });

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(PIPELINE, pipeline, 'utf-8');
  if (existsSync(SCREENED_URLS) || screened) writeFileSync(SCREENED_URLS, screened, 'utf-8');
  console.log(`add-to-pipeline: queued ${url}${company ? ` (${company})` : ''} under ## Pending`);
}

// Standard import.meta-main guard — mirrors pattern used by other cli/*.mjs scripts.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
