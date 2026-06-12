#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * screen.mjs — Personalized screener (provider-agnostic)
 *
 * Reads pending URLs from data/pipeline.md, fetches each JD in Node
 * (batch/jd-fetcher.mjs), spawns one headless LLM worker per URL via the
 * provider layer (claude / codex / opencode), parses the
 * trailing fenced JSON block from the worker's text response, and writes:
 *   - artifacts/reports/NNN-{slug}-{date}.md  (frontmatter + markdown body)
 *   - batch/tracker-additions/NNN-{slug}.tsv  (status=Screened|Discarded)
 *
 * Resumable: deduplicates via batch/screened-urls.txt.
 *
 * Usage:
 *   node batch/screen.mjs                   # screen all pending
 *   node batch/screen.mjs --parallel 5      # 5 concurrent workers
 *   node batch/screen.mjs --limit 3         # smoke test
 *   node batch/screen.mjs --url <url>       # screen ONLY this pending URL
 *   node batch/screen.mjs --dry-run         # preview, no API calls
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { getUsageSummary } from '../cli/usage-tracker.mjs';
import { buildScreeningPolicy, metadataPrefilter } from './screening-policy.mjs';
import { fetchJobDescription } from './jd-fetcher.mjs';
import { resolveRuntimeForMode, runModeLLM } from './lib/llm.mjs';
import { isValidIsoDate } from './lib/posted-date.mjs';
import { stripFrontMatter } from './lib/report-file.mjs';
import { trackModeUsage } from './lib/usage.mjs';

const ROOT = resolve(process.cwd());
const PIPELINE = `${ROOT}/data/pipeline.md`;
const SCAN_HISTORY = `${ROOT}/data/scan-history.tsv`;
const APPLICATIONS = `${ROOT}/data/applications.md`;
const CV = `${ROOT}/inputs/personalization/cv.md`;
const PROFILE = `${ROOT}/inputs/personalization/profile.yml`;
const CONFIG = `${ROOT}/inputs/config/config.yml`;
const PROMPT_FILE = `${ROOT}/content/modes/screen.md`;
const SCREENED_URLS = `${ROOT}/batch/screened-urls.txt`;
const REPORTS_DIR = `${ROOT}/artifacts/reports`;
const TRACKER_DIR = `${ROOT}/batch/tracker-additions`;
const LOGS_DIR = `${ROOT}/batch/logs/screen`;

function loadYamlFile(path) {
  try {
    if (!existsSync(path)) return {};
    return yaml.load(readFileSync(path, 'utf-8')) || {};
  } catch {
    return {};
  }
}

const settings = loadYamlFile(CONFIG);
const profileData = loadYamlFile(PROFILE);
const screeningPolicy = buildScreeningPolicy(settings, profileData);

// Resolve provider + model via the provider registry.
// We can't import registry.ts directly from this .mjs (server-only guard +
// bundler-style imports), so we spawn the tsx-backed `cli/resolve-mode.mjs`
// helper once per run. The result is reused for every URL — same as the
// legacy SCREEN_MODEL constant it replaces.
//
// Why not call the registry per-URL: parallel workers don't change the
// resolved model, and a per-URL tsx spawn would add ~50ms × N URLs of
// pointless overhead.
function resolveScreenRuntime() {
  try {
    return resolveRuntimeForMode(ROOT, 'screen');
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(TRACKER_DIR, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });

// ── Args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (n, def = null) => {
  const i = args.indexOf(n);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const PARALLEL = parseInt(
  flag('--parallel') || settings.advanced?.parallel_workers || settings.advanced?.screening?.parallel_workers || '8',
  10,
);
const LIMIT = parseInt(flag('--limit') || settings.screening?.smoke_test_limit || '0', 10);
// --url <url>: screen ONLY this pending URL, leaving any other pending entries
// untouched. The user-driven "Screen this offer" flow passes this so adding one
// offer screens just that offer — not the whole pending queue (which would sweep
// in unrelated/stale entries). Empty/absent ⇒ screen all pending (scan flow).
const ONLY_URL = (() => {
  const v = flag('--url');
  if (typeof v !== 'string') return null;
  try {
    return new URL(v).href;
  } catch {
    return v;
  }
})();
const TIMEOUT_MS = parseInt(
  settings.advanced?.timeout_ms || settings.advanced?.screening?.timeout_ms || '180000',
  10,
);
const DRY_RUN = args.includes('--dry-run');

// ── Dedup (screened-urls.txt) ────────────────────────────────────────
function loadDoneUrls() {
  if (!existsSync(SCREENED_URLS)) return new Set();
  const done = new Set();
  for (const line of readFileSync(SCREENED_URLS, 'utf-8').split('\n')) {
    if (line.trim()) done.add(line.trim());
  }
  return done;
}

// Flip a pipeline.md line `- [ ] <url>` → `- [x] <url>`. Returns true if a
// line was actually flipped. Pure pipeline-checkbox bookkeeping — does NOT
// touch screened-urls.txt (callers decide whether the URL also needs logging).
function markPipelineDone(url) {
  try {
    const text = readFileSync(PIPELINE, 'utf-8');
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^- \\[ \\] (${escaped})(\\s|$)`, 'm');
    if (!re.test(text)) return false;
    writeFileSync(PIPELINE, text.replace(re, '- [x] $1$2'), 'utf-8');
    return true;
  } catch (e) {
    console.warn(`markPipelineDone: failed to update pipeline.md for ${url}: ${e.message}`);
    return false;
  }
}

function markUrlDone(url) {
  // Append to screened-urls.txt for fast dedup, then flip the queue checkbox.
  appendFileSync(SCREENED_URLS, url + '\n', 'utf-8');
  markPipelineDone(url);
}

// Reconcile the queue against the screened-urls dedup log: a URL already in
// the log but still sitting as `- [ ]` in pipeline.md is "phantom pending" —
// screened (often discarded) yet counted as waiting, so it inflates the
// queue and makes a re-screen a confusing no-op. Flip those to `- [x]` so
// the two sources of truth agree and the offer leaves the pending queue.
// Returns the number reconciled. The scan dedups against scan-history, not
// this log, so without this an already-screened-and-discarded offer can be
// re-queued and linger forever.
function reconcileAlreadyScreened(alreadyScreenedUrls) {
  let flipped = 0;
  for (const url of alreadyScreenedUrls) {
    if (markPipelineDone(url)) flipped++;
  }
  return flipped;
}

// ── Pipeline reader ──────────────────────────────────────────────────
// Map URL → metadata captured at scan time (scan-history.tsv): the company
// `logo` (col 7) and the true posting date `posted` (col 8, YYYY-MM-DD).
// Older 6/7-column history files simply yield no logo / no posted, so the
// frontmatter falls back to a favicon/initials and the posted field is
// omitted. Exported + path-injectable for unit tests.
export function loadScanMeta(historyPath = SCAN_HISTORY) {
  const map = new Map();
  if (!existsSync(historyPath)) return map;
  const lines = readFileSync(historyPath, 'utf-8').split('\n');
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    const url = cols[0];
    if (!url) continue;
    const logo = (cols[6] || '').trim();
    const postedRaw = (cols[7] || '').trim();
    const posted = isValidIsoDate(postedRaw) ? postedRaw : '';
    if (logo || posted) map.set(url, { logo, posted });
  }
  return map;
}

function loadPending() {
  const text = readFileSync(PIPELINE, 'utf-8');
  const m = text.match(/## Pending\s*\n([\s\S]*?)(?=\n## |\s*$)/);
  if (!m) return [];
  const meta = loadScanMeta();
  const offers = [];
  for (const line of m[1].split('\n')) {
    // Match: `- [ ] <url><rest>` where rest is the optional pipe-delimited
    // metadata (` | company | title`). Splitting on `|` after capturing
    // the URL avoids the optional-group ambiguity in the previous regex,
    // which silently misallocated `company` into `title` when the title
    // field was empty (user-added URLs from POST /api/jobs/screen). That
    // misallocation made the metadata prefilter check search.terms against
    // the company slug — a guaranteed mismatch that discarded every
    // user-added offer before reaching the LLM.
    const lm = line.match(/^- \[ \] (\S+)(.*)$/);
    if (!lm) continue;
    const url = lm[1];
    const rest = lm[2] || '';
    // rest is either '' (URL-only entry) or starts with ' | company...'
    // Splitting on '|' yields ['', company, title?] after the leading
    // delimiter; .map(trim) normalises the whitespace flanking each pipe.
    const parts = rest.split('|').map(s => s.trim());
    const company = parts[1] || '';
    const title = parts[2] || '';
    const m2 = meta.get(url) || { logo: '', posted: '' };
    offers.push({ url, company, title, company_logo: m2.logo, posted: m2.posted });
  }
  return offers;
}

// ── Numbering ────────────────────────────────────────────────────────
// Next report number = (highest number across BOTH the reports dir AND the
// tracker) + 1.
//
// Two reasons for the dual source:
//  1. Variable-width prefix (`\d+`, NOT `\d{3}`): once reports cross 1000 a
//     fixed 3-digit pattern ignores every 4-digit file and keeps returning
//     ≈1000, colliding with existing 1000+ reports.
//  2. Reconcile against applications.md: the screener numbers off the reports
//     dir while merge-tracker numbers off the tracker. When they disagree —
//     e.g. a tracker row whose report file was renamed or is missing — the
//     screener would propose N, merge-tracker would bump to ++maxNum, and the
//     row number would drift from the report filename (#1008 row → 1007-*.md).
//     Taking the max of both sources guarantees the proposed number exceeds
//     every tracker row, so merge-tracker accepts it verbatim (num == file).
// Exported + path-injectable for unit testing.
export function nextReportNum(reportsDir = REPORTS_DIR, applicationsPath = APPLICATIONS) {
  let max = 0;
  const files = existsSync(reportsDir) ? readdirSync(reportsDir) : [];
  for (const f of files) {
    const m = f.match(/^(\d+)-/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  if (existsSync(applicationsPath)) {
    for (const line of readFileSync(applicationsPath, 'utf-8').split('\n')) {
      if (!line.startsWith('|')) continue;
      const parts = line.split('|').map(s => s.trim());
      if (parts.length < 9) continue;
      const n = parseInt(parts[1], 10);
      if (Number.isInteger(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

function slugify(s) {
  return (s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// Best-effort domain guess from a company name for the favicon fallback when
// the model omits `domain`. Strips spaces/punctuation and common legal
// suffixes ("Inc", "Ltd", "GmbH", …) and appends ".com". Wrong guesses are
// harmless — the avatar falls back to the company initial on a 404. Returns
// '' for an empty/Unknown company so we never key a logo off a non-company.
export function guessDomainFromCompany(company) {
  const base = (company || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|co|plc|sa|ag|bv|oy|ab|srl|pty)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
  if (!base || base === 'unknown') return '';
  return `${base}.com`;
}

// ── Worker ───────────────────────────────────────────────────────────

function buildUserMessage(offer, jd, cvContent, profileContent) {
  // jd is { text, status: 'ok' | 'incomplete' | 'error' } from
  // batch/jd-fetcher.mjs. We inline whatever the fetcher returned (even
  // for incomplete pages — the prompt's `__JD_INCOMPLETE__` marker tells
  // the model to emit `readable: false` rather than fabricate a score).
  const jdBlock =
    jd.status === 'ok'
      ? jd.text
      : jd.status === 'incomplete'
        ? `${jd.text}\n\n__JD_INCOMPLETE__ (fetched only ${jd.text.length} chars; likely SPA/consent wall)`
        : `__JD_INCOMPLETE__ (fetch failed: ${jd.error ?? 'unknown'})`;
  return `Screen this job offer. Emit ONE fenced JSON block at the very end of your response per the system prompt — no tool calls, no file writes.

Candidate CV (full):
\`\`\`markdown
${cvContent}
\`\`\`

Candidate profile (preferences — drives the score axes):
\`\`\`yaml
${profileContent}
\`\`\`

Job posting:
- URL: ${offer.url}
- Hinted title: ${offer.title || '(unknown — derive from JD body)'}
- Hinted company: ${offer.company || '(unknown — derive from JD body)'}
- Score threshold: ${screeningPolicy.scoreThreshold}

Job description content (plain text, already fetched):
\`\`\`text
${jdBlock}
\`\`\``;
}

// Parse the trailing fenced block from the LLM's text response. The
// screen.md contract says "exactly one fenced JSON block at the very END
// of the response"; we tolerate trailing whitespace and any language
// annotation on the fence ('```json', '```yaml', or bare '```'), and we
// parse with yaml.load — a strict superset of JSON — so a model that
// emits YAML keys instead of JSON still lands.
export function parseScreenResponse(responseText) {
  const text = String(responseText || '');
  const fenceRe = /```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/;
  const m = text.match(fenceRe);
  if (!m) throw new Error('no trailing fenced block in response');
  const parsed = yaml.load(m[1]);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('trailing fenced block did not yield an object');
  }
  return parsed;
}

// Deterministically assemble the markdown-native screener report + tracker TSV
// from the worker's structured JSON. Pure + exported for unit tests; one path
// for Screened / Discarded (including unreadable pages). Mirrors the evaluation
// report shape (frontmatter + ## TL;DR + ## Role summary + ### Gaps) but short.
// Unreadable pages (worker `readable:false`, or Unknown company + no score)
// reuse Discarded with score N/A — never a fabricated 0.0.
export function buildScreenReport(fields, scoreThreshold) {
  const { num, slug, date, url } = fields;
  const company = (fields.company || '').trim();
  const hasScore = typeof fields.score === 'number' && Number.isFinite(fields.score);
  const unreadable = fields.readable === false || (!company && !hasScore);
  const clean = v => String(v ?? '').replace(/[|\t\r\n]+/g, ' ').trim();
  // A metadata prefilter rejection (geo/comp/etc.): force Discarded regardless
  // of the score threshold, with the reason as the TL;DR + note.
  const forced = !unreadable && clean(fields.discardReason) !== '';

  const scoreOut = unreadable || !hasScore ? 'N/A' : Number(fields.score).toFixed(1);
  let status;
  if (unreadable || forced) status = 'Discarded';
  else
    status =
      hasScore && Number(scoreThreshold) > 0 && fields.score < scoreThreshold
        ? 'Discarded'
        : 'Screened';

  const displayCompany = company || 'Unknown';
  const displayRole = clean(fields.role) || (unreadable ? 'Unreadable posting' : 'Unknown role');
  const tldr = unreadable
    ? "Couldn't be read — JS-rendered or bot-walled page. Try the company's own careers page."
    : forced
      ? clean(fields.discardReason)
      : clean(fields.tldr);

  // Company logo, in priority order:
  //   1. explicit URL from the worker / scan source (JobSpy logo column),
  //   2. favicon from the model-provided domain,
  //   3. favicon from a domain GUESSED off the company name.
  // The small screener model often omits `domain`, and one-link re-scans carry
  // no scan-source logo — without (3) those offers render avatar-less. The
  // guess (slug + ".com") is frequently right (deepgram.com, stripe.com) and
  // harmless when wrong: CompanyAvatar falls back to the company initial on a
  // 404. Skipped for unreadable pages (no real company to key on).
  const domain = clean(fields.domain) || (unreadable ? '' : guessDomainFromCompany(company));
  const companyLogo =
    clean(fields.company_logo) ||
    (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : '');

  // True posting date captured at scan time (or supplied by the worker),
  // already normalized to YYYY-MM-DD. Invalid/absent → the field is omitted
  // entirely (never an empty string). `date` stays the scan/screen date.
  const posted = isValidIsoDate(fields.posted) ? fields.posted : undefined;

  const fm = {
    num,
    company: displayCompany,
    role: displayRole,
    date,
    ...(posted ? { posted } : {}),
    url,
    status,
    state: 'screened',
    score: scoreOut === 'N/A' ? 'N/A' : Number(scoreOut),
    archetype: clean(fields.archetype),
    seniority: clean(fields.seniority),
    work_mode: clean(fields.work_mode),
    location: clean(fields.location),
    comp: clean(fields.comp),
    legitimacy: clean(fields.legitimacy) || 'low_confidence',
    company_logo: companyLogo,
    tldr,
  };
  if (!unreadable && fields.score_breakdown && Object.keys(fields.score_breakdown).length) {
    fm.score_breakdown = fields.score_breakdown;
  }
  const frontmatter = yaml.dump(fm, { lineWidth: -1 }).trimEnd();

  // Body follows the Report markdown contract (_shared.md): a Next Steps callout
  // first, then a bare `## TL;DR` heading, the bold verdict, an Axis|Score|Read
  // table, and `<div data-callout>` blocks for the strongest signal + watch-out.
  // The normalizer heals the rest on load.
  const calloutDiv = (variant, emoji, body) =>
    `<div data-callout data-variant="${variant}" data-emoji="${emoji}">\n\n${body}\n\n</div>`;

  // Next Steps: the single most consequential action. Prefer the worker's
  // role-specific judgment (`next_steps`); fall back to a deterministic action
  // by outcome when the worker didn't emit one (e.g. an unreadable page).
  // Variant + emoji are always outcome-driven, so the color matches
  // pursue / skip / re-screen regardless of the wording.
  let nsVariant;
  let nsEmoji;
  let nsFallback;
  if (unreadable) {
    nsVariant = 'info';
    nsEmoji = '💡';
    nsFallback = "Re-screen the company's own careers page; this URL couldn't be read.";
  } else if (status === 'Discarded') {
    nsVariant = 'error';
    nsEmoji = '🛑';
    nsFallback =
      forced && clean(fields.discardReason)
        ? `Skip. ${clean(fields.discardReason)}`
        : 'Skip. Screened below your fit threshold.';
  } else {
    nsVariant = 'info';
    nsEmoji = '💡';
    nsFallback = 'Run a full evaluation to decide whether to pursue.';
  }
  const nextSteps = calloutDiv(
    nsVariant,
    nsEmoji,
    `**Next Steps** ${clean(fields.next_steps) || nsFallback}`,
  );

  const sb =
    !unreadable && fields.score_breakdown && Object.keys(fields.score_breakdown).length
      ? fields.score_breakdown
      : null;
  // `tldr` already carries its own bold scan-anchor (e.g. "**Right at the
  // threshold.** …"); emit it verbatim rather than wrapping the whole line.
  const parts = [nextSteps, '', '## TL;DR', '', tldr, ''];
  if (unreadable) {
    parts.push(
      "The job page could not be read (JavaScript-rendered or bot-walled). This is a fetch failure, not a true rejection: open the company's own careers page and re-screen that URL.",
      '',
    );
  }
  if (sb) {
    const AXES = [
      ['CV match', 'cv_match'],
      ['Seniority', 'seniority'],
      ['Compensation', 'compensation'],
      ['Domain', 'domain'],
      ['Geo', 'geo'],
      ['Legitimacy', 'legitimacy'],
    ];
    const reads = fields.axis_reads || {};
    parts.push('| Axis | Score | Read |', '| --- | --- | --- |');
    for (const [label, key] of AXES) {
      const v = typeof sb[key] === 'number' ? Number(sb[key]).toFixed(1) : '—';
      parts.push(`| ${label} | ${v} | ${clean(reads[key]) || '—'} |`);
    }
    parts.push('');
  }
  const signal = clean(fields.strongest_signal);
  const watch = clean(fields.watch_out);
  if (signal) parts.push(calloutDiv('success', '✅', `**Strongest signal** ${signal}`), '');
  if (watch) parts.push(calloutDiv('warn', '⚠️', `**Watch-out** ${watch}`), '');
  const report = `---\n${frontmatter}\n---\n\n${parts.join('\n')}`;

  // Tracker TSV — table order (…role, score, status, pdf, report, notes,
  // posted), 10 cols. `posted` is last (empty when unknown) so 9-col legacy
  // consumers stay readable.
  const reportPath = `artifacts/reports/${String(num).padStart(3, '0')}-${slug}-${date}.md`;
  const note = unreadable
    ? 'unreadable — JS/bot-walled page; try the careers page'
    : forced
      ? clean(fields.discardReason)
      : status === 'Discarded'
        ? `below score threshold ${scoreThreshold}`
        : 'screened';
  const scoreCol = scoreOut === 'N/A' ? 'N/A' : `${scoreOut}/5`;
  const tsv = [
    num,
    date,
    displayCompany,
    displayRole,
    scoreCol,
    status,
    '❌',
    `[${num}](${reportPath})`,
    clean(note).slice(0, 120),
    posted || '',
  ].join('\t');

  return { report, tsv, status, reportPath };
}

function makeScreenOne(runtime, cvContent, profileContent) {
  return async function screenOne(offer, idx, total, num) {
    const date = new Date().toISOString().slice(0, 10);
    const slug = slugify(offer.company);
    const reportPath = `artifacts/reports/${String(num).padStart(3, '0')}-${slug}-${date}.md`;
    const tsvPath = `batch/tracker-additions/${String(num).padStart(3, '0')}-${slug}.tsv`;
    const logPath = `${LOGS_DIR}/screen-${num}.log`;

    process.stdout.write(`[${idx + 1}/${total}] #${num} ${offer.company} — ${(offer.title || '').slice(0, 60)}… `);

    if (DRY_RUN) {
      console.log(`(dry-run) would write ${reportPath} + ${tsvPath}`);
      return;
    }

    // Assemble the markdown-native report + tracker TSV from a fields object and
    // write both. One path for prefilter-discard, normal, and unreadable results.
    const emit = fields => {
      const merged = { ...fields, num, slug, date, url: offer.url };
      // Prefer the worker's logo; otherwise use the one jobspy captured at scan
      // time. buildScreenReport still falls back to a favicon when both are empty.
      if (!merged.company_logo && offer.company_logo) merged.company_logo = offer.company_logo;
      // True posting date captured at scan time (scan-history `posted` column);
      // buildScreenReport validates and omits when absent/invalid.
      if (!merged.posted && offer.posted) merged.posted = offer.posted;
      const { report, tsv, status } = buildScreenReport(merged, screeningPolicy.scoreThreshold);
      writeFileSync(`${ROOT}/${reportPath}`, report, 'utf-8');
      writeFileSync(`${ROOT}/${tsvPath}`, `${tsv}\n`, 'utf-8');
      markUrlDone(offer.url);
      return status;
    };

    // Metadata prefilter — a cheap title-match rejection the BULK SCAN flow uses
    // to drop obvious mismatches before spending a worker. Skip it for a
    // user-initiated single-URL screen (--url): the user hand-picked this offer,
    // so always fetch and let the screener read the real JD. (For a bare URL we
    // only know the company slug anyway — the prefilter would otherwise judge
    // that slug as a "title" and wrongly discard. `discardReason` forces
    // Discarded regardless of score threshold.)
    const prefilter = ONLY_URL ? { action: 'screen' } : metadataPrefilter(offer, screeningPolicy);
    if (prefilter.action === 'discard') {
      emit({
        readable: true,
        company: offer.company,
        role: offer.title,
        discardReason: `Prefiltered: ${prefilter.reason}`,
      });
      console.log(`⏭️  prefilter discard: ${prefilter.reason}`);
      return;
    }

    // Fetch the JD in Node so the prompt is self-contained and the LLM
    // doesn't need a provider-specific web tool. A hard fetch failure
    // skips the LLM call entirely — we already know the page is unreadable,
    // so spending a worker on it would only invite fabrication.
    const jd = await fetchJobDescription(offer.url);
    if (jd.status === 'error') {
      const status = emit({ readable: false });
      console.log(`⚠️  JD fetch failed (${jd.error ?? 'unknown'}) — recorded as ${status}`);
      return;
    }
    const userMsg = buildUserMessage(offer, jd, cvContent, profileContent);
    const promptWithSystem = `${stripFrontMatter(readFileSync(PROMPT_FILE, "utf-8"))}\n\n---\n\n${userMsg}`;
    const result = await runModeLLM(ROOT, "screen", promptWithSystem, {
      timeoutMs: TIMEOUT_MS,
      logsDir: LOGS_DIR,
      // Single resolution: reuse the runtime resolved at startup so the
      // spawn cannot resolve differently from the banner/usage labels.
      runtime,
    });
    try { writeFileSync(logPath, `STDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}\n`, 'utf-8'); } catch {}

    // Surface the fallback to OUR stdout — parallel workers don't tee the
    // child stdout (it would interleave), so the job runner can't see the
    // [FALLBACK] marker that runModeLLM embedded in the child's output. One
    // console.log per line is atomic enough alongside the existing per-URL logs.
    if (result.usedFallback) {
      console.log(`[FALLBACK] ${JSON.stringify(result.usedFallback)}`);
      console.log(`↻ fallback: ${result.usedFallback.from.provider}/${result.usedFallback.from.model} → ${result.usedFallback.to.provider}/${result.usedFallback.to.model} (${result.usedFallback.reason})`);
    }

    if (!result.ok) {
      // LLM run failed (timeout / provider error / fallback exhausted) — a
      // transient infra failure, not a verdict on the offer. No report or
      // tracker row exists, so marking the URL done here would silently
      // drop it forever (dedup blocks re-screening). Leave it unticked in
      // pipeline.md so the next run retries it.
      console.log(`❌ ${result.error} — left pending for retry`);
      return;
    }

    // Parse the fenced JSON block the LLM emitted in its response body.
    // No/invalid block → unreadable → Discarded (not a silent skip).
    let fields;
    try {
      fields = parseScreenResponse(result.stdout);
    } catch (err) {
      fields = { readable: false };
      console.log(`⚠️  no parsable fenced block (${err.message}) — recording as unreadable`);
    }
    const status = emit(fields);

    // Track tokens via tiktoken estimation across all providers — uniform
    // accuracy beats per-provider stdout parsing, and text-format output
    // (the portable contract) carries no native usage object anyway.
    // Label token estimates with the pair that actually ran — on a fallback,
    // the primary runtime never produced the output, so charging it would
    // misattribute usage.
    const actualRuntime = result.usedFallback
      ? { ...runtime, provider: result.usedFallback.to.provider, model: result.usedFallback.to.model }
      : runtime;
    try {
      trackModeUsage(actualRuntime, "screen", result.promptText, result.stdout);
    } catch (err) {
      console.warn(`token tracking failed: ${err.message}`);
    }

    console.log(`✅ ${status}${typeof fields.score === 'number' ? ` (${fields.score})` : ''}`);
  };
}

// ── Pool ─────────────────────────────────────────────────────────────
async function runPool(items, handler, concurrency) {
  let nextNum = nextReportNum();
  const queue = items.map((item, idx) => ({ item, idx, num: nextNum++ }));
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      await handler(next.item, next.idx, items.length, next.num);
    }
  });
  await Promise.all(workers);
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  // Pre-flight + provider resolution live here (not at module scope) so
  // importing buildScreenReport/parseScreenResponse in unit tests never
  // touches user files or spawns the tsx resolver.
  if (!existsSync(CV)) { console.error(`ERROR: ${CV} missing`); process.exit(1); }
  if (!existsSync(PROMPT_FILE)) { console.error(`ERROR: ${PROMPT_FILE} missing`); process.exit(1); }
  if (!existsSync(PIPELINE)) { console.error(`ERROR: ${PIPELINE} missing`); process.exit(1); }
  const runtime = resolveScreenRuntime();
  const cvContent = readFileSync(CV, 'utf-8');
  // Profile is inlined into every user message so the worker has the targeting
  // preferences (archetypes, preferred_yoe, comp floor, locations, etc.)
  // without needing a file Read tool — see content/modes/screen.md hard rules.
  // Falls back to a stub if profile.yml is missing so onboarding-incomplete
  // installs don't crash the screener.
  const profileContent = existsSync(PROFILE)
    ? readFileSync(PROFILE, 'utf-8')
    : '# (profile.yml missing — score axes with neutral assumptions)';

  let offers = loadPending();
  // Scope to a single URL when --url is given (user-driven single-offer screen).
  if (ONLY_URL) offers = offers.filter(o => o.url === ONLY_URL);
  const done = loadDoneUrls();
  const pending = offers.filter(o => !done.has(o.url));
  const work = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;

  // Reconcile phantom-pending: pending `[ ]` rows already in the screened
  // log get flipped to `[x]` so they leave the queue (skip in --url mode,
  // which scopes to one offer the user explicitly asked to re-screen).
  const reconciled = ONLY_URL
    ? 0
    : reconcileAlreadyScreened(offers.filter(o => done.has(o.url)).map(o => o.url));

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Screener — ${runtime.provider}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Pipeline pending: ${offers.length}`);
  console.log(
    `Already screened: ${offers.length - pending.length}${reconciled > 0 ? ` (${reconciled} cleared from queue)` : ''}`,
  );
  console.log(`To process:       ${work.length}${LIMIT > 0 ? ` (limited)` : ''}`);
  console.log(`Parallel:         ${PARALLEL}`);
  console.log(`Model:            ${runtime.model} (resolved from ${runtime.resolvedFrom})`);
  console.log('');

  if (work.length === 0) { console.log('Nothing to do.'); return; }
  await runPool(work, makeScreenOne(runtime, cvContent, profileContent), Math.max(1, PARALLEL));

  // Summary
  const usage = getUsageSummary();
  const bucket = usage.currentMonthData?.[runtime.provider] || { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  console.log('');
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Reports:   ${REPORTS_DIR}/`);
  console.log(`Trackers:  ${TRACKER_DIR}/`);
  console.log('');
  console.log(`Month totals (${usage.monthKey}):`);
  console.log(`   ${runtime.provider}:  ${bucket.calls} calls, ${(bucket.input_tokens || 0).toLocaleString()} in / ${(bucket.output_tokens || 0).toLocaleString()} out, $${(bucket.cost_usd || 0).toFixed(4)}`);
  console.log('');
  console.log('Next: node cli/merge-tracker.mjs');
}

// import.meta-main guard so importing this module (e.g. buildScreenReport in
// unit tests) doesn't spawn the screener.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Pre-flight checks live at the top of main() — same CLI-only semantics.
  main().catch(err => { console.error('FATAL:', err); process.exit(1); });
}
