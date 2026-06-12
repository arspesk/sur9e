#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * scan-portals.mjs — Zero-token ATS portal scanner
 *
 * Fetches Greenhouse, Ashby, Lever, Workday, Workable, Recruitee,
 * SmartRecruiters, and SolidJobs job feeds directly
 * over HTTP, applies the same title sieve JobSpy uses (profile.yml
 * `search.terms`), deduplicates against scan-history.tsv + pipeline.md +
 * applications.md, and appends survivors to data/pipeline.md.
 *
 * Pure HTTP + JSON — zero AI tokens.
 *
 * For a company whose careers page isn't one of the built-in ATS, a
 * tracked_companies entry can set a `parser:` block pointing at a local script
 * (under inputs/parsers/) that emits {jobs:[...]} — the universal escape hatch.
 *
 * Companies come from inputs/personalization/portals.yml (`tracked_companies`).
 * The scanner self-gates on inputs/config/config.yml `scanning.sources.ats`:
 * when that flag is explicitly false it no-ops. When the flag is on (default)
 * but portals.yml is absent or empty, it logs and exits 0 — never an error,
 * so the scan → screen → merge chain keeps running for JobSpy-only users.
 *
 * Usage:
 *   node batch/scan-portals.mjs              # scan all enabled companies + write
 *   node batch/scan-portals.mjs --dry-run    # preview, write nothing
 *   node batch/scan-portals.mjs --company X  # scan a single company (substring)
 */

import { execFile } from 'child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'fs';
import { resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import yaml from 'js-yaml';
import { buildLocationMatcher, buildTitleMatcher } from './lib/job-filter.mjs';
import { parseWorkdayPostedOn, toIsoDate } from './lib/posted-date.mjs';

const execFileAsync = promisify(execFile);

// Local-parser escape hatch (Wave E). A tracked_companies entry with a
// `parser:` block runs a local script that emits {jobs:[...]} — for companies
// whose careers page isn't one of the built-in ATS. Guardrails: `command` must
// be one of these interpreters, the `script` must resolve inside inputs/parsers/
// (set below), it runs via execFile (no shell), and is timeout + buffer capped.
const ALLOWED_PARSER_COMMANDS = new Set([
  'python3',
  'python',
  'node',
  'deno',
  'bash',
  'sh',
  'ruby',
]);
const LOCAL_PARSER_TIMEOUT_MS = 20_000;
const LOCAL_PARSER_MAX_BUFFER = 2_000_000;

const ROOT = resolve(process.cwd());
// Local parser scripts must live here — a config can't point at a system binary.
const PARSERS_DIR = resolve(ROOT, 'inputs', 'parsers');
const PORTALS_PATH = `${ROOT}/inputs/personalization/portals.yml`;
const CONFIG_PATH = `${ROOT}/inputs/config/config.yml`;
const PROFILE_PATH = `${ROOT}/inputs/personalization/profile.yml`;
const SCAN_HISTORY_PATH = `${ROOT}/data/scan-history.tsv`;
const PIPELINE_PATH = `${ROOT}/data/pipeline.md`;
const APPLICATIONS_PATH = `${ROOT}/data/applications.md`;

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const companyFlag = args.indexOf('--company');
const FILTER_COMPANY = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

function loadYaml(path) {
  return existsSync(path) ? yaml.load(readFileSync(path, 'utf-8')) || {} : {};
}

// ── Filters (shared with scan-jobspy via batch/lib/job-filter.mjs) ───
// Positive-only title sieve + a location filter, both derived from profile.yml
// so the two scanners can't drift. ATS feeds return every office's postings, so
// the location filter is what keeps an offer in Tokyo out of a US-only hunt.
const profile = loadYaml(PROFILE_PATH);
const titleMatches = buildTitleMatcher(profile);
const locationMatches = buildLocationMatcher(profile);

// ── Host allowlist (SSRF hardening) ─────────────────────────────────
// Every ATS URL we fetch is built from a hardcoded host + a slug we extract,
// OR (greenhouse) taken from a user-supplied `api:` field. Before any fetch we
// assert the URL is HTTPS and its hostname matches the expected ATS host for
// that type — so a malicious portals.yml `api:` (e.g. https://evil/?greenhouse)
// or a redirect can't point the scanner at an arbitrary host. Exported for
// unit tests.
const ATS_HOST_RULES = {
  greenhouse: h => h === 'boards-api.greenhouse.io',
  ashby: h => h === 'api.ashbyhq.com',
  lever: h => h === 'api.lever.co',
  workable: h => h === 'apply.workable.com',
  workday: h => /^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(h),
  recruitee: h => /^[a-z0-9][a-z0-9-]*\.recruitee\.com$/.test(h),
  smartrecruiters: h => h === 'api.smartrecruiters.com',
  solidjobs: h => h === 'solid.jobs',
};

export function assertAtsUrl(url, type) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${type}: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:') throw new Error(`${type}: URL must use HTTPS: ${url}`);
  const allows = ATS_HOST_RULES[type];
  if (!allows || !allows(u.hostname)) {
    throw new Error(`${type}: untrusted host "${u.hostname}" for ${url}`);
  }
  if (type === 'solidjobs' && !u.pathname.startsWith('/public-api/offers/')) {
    throw new Error(`solidjobs: URL path must start with /public-api/offers/: ${url}`);
  }
  return url;
}

// ── API detection ───────────────────────────────────────────────────
function detectApi(company) {
  // Local parser wins over everything: an explicit `parser:` block means the
  // user configured a custom script for this company. Validation (command
  // allowlist + script path) happens at fetch time so a bad config surfaces as
  // a per-company scan error, not a silent fall-through to ATS detection.
  if (company.parser?.command) {
    return { type: 'local', parser: company.parser, careersUrl: company.careers_url || '' };
  }

  // Greenhouse: explicit api field wins.
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return { type: 'lever', url: `https://api.lever.co/v0/postings/${leverMatch[1]}` };
  }

  // Greenhouse boards (incl. EU)
  const ghMatch = url.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghMatch[1]}/jobs`,
    };
  }

  // Workable — apply.workable.com/{account} or {account}.workable.com
  const workableMatch =
    url.match(/apply\.workable\.com\/([^/?#]+)/) ||
    url.match(/https?:\/\/([^.]+)\.workable\.com/);
  if (workableMatch) {
    return {
      type: 'workable',
      url: `https://apply.workable.com/api/v1/widget/accounts/${workableMatch[1]}?details=true`,
    };
  }

  // Workday — {tenant}.{shard}.myworkdayjobs.com/{site}
  // API endpoint is /wday/cxs/{tenant}/{site}/jobs (POST, paginated).
  const workdayMatch = url.match(
    /https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:([^/?#]+)\/)?([^/?#]+)/,
  );
  if (workdayMatch) {
    const [, tenant, shard, , site] = workdayMatch;
    return {
      type: 'workday',
      url: `https://${tenant}.${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`,
      _workdayBase: `https://${tenant}.${shard}.myworkdayjobs.com`,
    };
  }

  // Recruitee — {slug}.recruitee.com → public per-tenant offers API.
  const recruiteeMatch = url.match(/^https:\/\/([a-z0-9][a-z0-9-]*)\.recruitee\.com/i);
  if (recruiteeMatch) {
    const slug = recruiteeMatch[1].toLowerCase();
    return { type: 'recruitee', url: `https://${slug}.recruitee.com/api/offers/` };
  }

  // SmartRecruiters — (careers|jobs).smartrecruiters.com/{slug} → postings API
  // (paginated; fetchSmartRecruitersAll walks the pages).
  const srMatch = url.match(/^https:\/\/(?:careers|jobs)\.smartrecruiters\.com\/([^/?#]+)/);
  if (srMatch) {
    return {
      type: 'smartrecruiters',
      url: `https://api.smartrecruiters.com/v1/companies/${srMatch[1]}/postings?limit=100&offset=0&status=PUBLIC`,
    };
  }

  // SolidJobs — the careers_url IS the public-api offers endpoint.
  if (/^https:\/\/solid\.jobs\/public-api\/offers\//.test(url)) {
    return { type: 'solidjobs', url };
  }

  return null;
}

// ── API parsers ─────────────────────────────────────────────────────
// Each parser also captures the true posting date (`posted`, YYYY-MM-DD) from
// the field its ATS exposes — parse-and-keep from responses we already fetch,
// zero extra network calls. Absent/invalid dates omit the field entirely
// (never an empty string). Exported for unit tests over fixture JSON.
export function parseGreenhouse(json, companyName) {
  return (json.jobs || []).map(j => {
    // Prefer first_published (the original posting date); updated_at is a
    // bump-prone fallback.
    const posted = toIsoDate(j.first_published) ?? toIsoDate(j.updated_at);
    return {
      title: j.title || '',
      url: j.absolute_url || '',
      company: companyName,
      location: j.location?.name || '',
      ...(posted ? { posted } : {}),
    };
  });
}

export function parseAshby(json, companyName) {
  return (json.jobs || []).map(j => {
    const posted = toIsoDate(j.publishedAt);
    return {
      title: j.title || '',
      url: j.jobUrl || '',
      company: companyName,
      location: j.location || '',
      ...(posted ? { posted } : {}),
    };
  });
}

export function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => {
    // Lever reports createdAt as epoch milliseconds.
    const posted = typeof j.createdAt === 'number' ? toIsoDate(j.createdAt) : undefined;
    return {
      title: j.text || '',
      url: j.hostedUrl || '',
      company: companyName,
      location: j.categories?.location || '',
      ...(posted ? { posted } : {}),
    };
  });
}

export function parseWorkable(json, companyName) {
  return (json.jobs || []).map(j => {
    // Workable's widget API exposes published_on (YYYY-MM-DD, verified live
    // 2026-06-10); created_at is the fallback for older payloads.
    const posted = toIsoDate(j.published_on) ?? toIsoDate(j.created_at);
    return {
      title: j.title || '',
      url: j.url || j.application_url || j.shortlink || '',
      company: companyName,
      location: j.location?.location_str || j.city || j.country || '',
      ...(posted ? { posted } : {}),
    };
  });
}

export function parseWorkday(json, companyName, apiInfo, scanDate) {
  const base = apiInfo?._workdayBase || '';
  return (json.jobPostings || []).map(p => {
    // Workday only exposes relative human text ("Posted 3 Days Ago") —
    // resolved best-effort against the scan date; unparseable forms omit.
    const posted = parseWorkdayPostedOn(p.postedOn, scanDate);
    return {
      title: p.title || '',
      url: p.externalPath ? `${base}${p.externalPath}` : p.hiringPath || '',
      company: companyName,
      location: p.locationsText || p.location || '',
      ...(posted ? { posted } : {}),
    };
  });
}

export function parseRecruitee(json, companyName) {
  const offers = Array.isArray(json?.offers) ? json.offers : [];
  return offers.map(j => {
    const remote = j.remote ? 'Remote' : '';
    const location =
      j.location || [j.city || '', j.country || '', remote].filter(Boolean).join(', ');
    // Only trust an offer URL that resolves to the tenant's recruitee host.
    let url = '';
    const raw = j.careers_url || j.url || '';
    if (typeof raw === 'string' && raw) {
      try {
        const u = new URL(raw);
        if (u.protocol === 'https:' && /^[a-z0-9][a-z0-9-]*\.recruitee\.com$/.test(u.hostname)) {
          url = u.href;
        }
      } catch {
        // malformed → drop the URL
      }
    }
    const posted = toIsoDate(j.published_at) ?? toIsoDate(j.created_at);
    return { title: j.title || '', url, company: companyName, location, ...(posted ? { posted } : {}) };
  });
}

export function parseSmartrecruiters(json, companyName) {
  const items = Array.isArray(json?.content) ? json.content : [];
  return items.map(j => {
    const loc = j.location || {};
    const full = loc.fullLocation || [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
    const remote = loc.remote ? 'Remote' : '';
    const location = [full, remote].filter(Boolean).join(', ');
    // `ref` is api.smartrecruiters.com/v1/companies/<slug>/postings/<id>;
    // rewrite to the public jobs.smartrecruiters.com URL.
    let url = '';
    if (typeof j.ref === 'string') {
      try {
        const u = new URL(j.ref);
        if (
          u.protocol === 'https:' &&
          u.hostname === 'api.smartrecruiters.com' &&
          u.pathname.startsWith('/v1/companies/')
        ) {
          url = `https://jobs.smartrecruiters.com/${u.pathname.slice('/v1/companies/'.length)}`;
        }
      } catch {
        // malformed → drop the URL
      }
    }
    const posted = toIsoDate(j.releasedDate) ?? toIsoDate(j.createdOn);
    return { title: j.name || '', url, company: companyName, location, ...(posted ? { posted } : {}) };
  });
}

export function parseSolidjobs(json, companyName) {
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  // SolidJobs offer URLs point at the external company posting (not solid.jobs),
  // so they're used as-is; rows without a URL are dropped.
  return jobs
    .filter(j => j && typeof j.url === 'string' && j.url.trim() !== '')
    .map(j => {
      const location = Array.isArray(j.locations)
        ? j.locations.join(', ')
        : typeof j.locations === 'string'
          ? j.locations
          : '';
      const posted = toIsoDate(j.publishedDate);
      return {
        title: j.title || '',
        url: j.url,
        company: j.company || companyName,
        location,
        ...(posted ? { posted } : {}),
      };
    });
}

// Flatten a location that a local parser might emit as a string, an array, or
// an object ({name}/{text}).
function normalizeLocation(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(normalizeLocation).filter(Boolean).join(', ');
  if (typeof value === 'object') return String(value.name || value.text || '').trim();
  return String(value).trim();
}

// Normalize a local parser's emitted jobs into our posting shape. Accepts a
// bare array or {jobs:[...]} / {results:[...]}; resolves relative job URLs
// against the company's careers_url; drops rows missing a title or URL.
export function parseLocal(json, companyName, apiInfo) {
  const base = apiInfo?.careersUrl || '';
  const jobs = Array.isArray(json) ? json : json?.jobs || json?.results || [];
  if (!Array.isArray(jobs)) return [];
  return jobs
    .map(j => {
      if (!j || typeof j !== 'object') return null;
      const title = String(j.title || j.name || '').trim();
      const raw = j.url || j.jobUrl || j.job_url || j.applyUrl || j.apply_url || '';
      let url = '';
      if (raw) {
        try {
          url = new URL(String(raw).trim(), base || undefined).href;
        } catch {
          // unresolvable → drop the row below
        }
      }
      if (!title || !url) return null;
      const posted = toIsoDate(j.posted) ?? toIsoDate(j.published_at) ?? toIsoDate(j.date);
      return {
        title,
        url,
        company: String(j.company || companyName || '').trim(),
        location: normalizeLocation(j.location || j.locations),
        ...(posted ? { posted } : {}),
      };
    })
    .filter(Boolean);
}

const PARSERS = {
  greenhouse: parseGreenhouse,
  ashby: parseAshby,
  lever: parseLever,
  workable: parseWorkable,
  workday: parseWorkday,
  recruitee: parseRecruitee,
  smartrecruiters: parseSmartrecruiters,
  solidjobs: parseSolidjobs,
  local: parseLocal,
};

// ── Fetch with timeout ──────────────────────────────────────────────
// redirect defaults to 'error': ATS APIs return JSON directly and never
// legitimately 3xx cross-host, so refusing redirects keeps a hostile redirect
// from bouncing an assert-validated URL to an arbitrary host.
async function fetchJson(url, { redirect = 'error' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonPost(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Workday paginates: page /jobs with increasing offset until exhausted.
async function fetchWorkdayAll(url, { limit = 20, maxPages = 25 } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const body = { appliedFacets: {}, limit, offset: page * limit, searchText: '' };
    let json;
    try {
      json = await fetchJsonPost(url, body);
    } catch (err) {
      if (page === 0) throw err; // first-page failure is fatal
      break;
    }
    const postings = json.jobPostings || [];
    all.push(...postings);
    if (postings.length < limit) break;
    if (all.length >= (json.total ?? Infinity)) break;
  }
  return { jobPostings: all };
}

// SmartRecruiters paginates: walk /postings with increasing offset until a
// short page. Each page URL is host-validated and fetched with redirect:'error'
// (no cross-host hops). `firstUrl` is the offset=0 URL detectApi built.
async function fetchSmartRecruitersAll(firstUrl, { pageSize = 100, maxPages = 50 } = {}) {
  const u = new URL(firstUrl);
  u.searchParams.set('limit', String(pageSize));
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    u.searchParams.set('offset', String(page * pageSize));
    const pageUrl = assertAtsUrl(u.toString(), 'smartrecruiters');
    let json;
    try {
      json = await fetchJson(pageUrl);
    } catch (err) {
      if (page === 0) throw err; // first-page failure is fatal
      break;
    }
    const items = json?.content || [];
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return { content: all };
}

// Substitute {careers_url}/{company} placeholders in a parser arg. Exported for
// unit tests.
export function expandParserArg(value, careersUrl, company) {
  return String(value)
    .replaceAll('{careers_url}', careersUrl || '')
    .replaceAll('{company}', company || '');
}

// Run a company's local parser script and return its parsed JSON. Validation is
// the security boundary: only an allowlisted interpreter, and the script must
// resolve INSIDE inputs/parsers/ — checked both lexically and after canonicalizing
// symlinks. Spawned via execFile (no shell) with a timeout + max-buffer cap.
// Throws a clear error on any violation — the caller catches it per-company.
// `root`/`parsersDir` are an injection seam for tests; production always uses the
// locked ROOT / inputs/parsers defaults. Exported for unit tests.
export async function fetchLocalParser(apiInfo, company, { root = ROOT, parsersDir = PARSERS_DIR } = {}) {
  const parser = apiInfo?.parser || {};
  const command = String(parser.command || '');
  if (!ALLOWED_PARSER_COMMANDS.has(command)) {
    throw new Error(
      `local parser command "${command}" not allowed (use one of: ${[...ALLOWED_PARSER_COMMANDS].join(', ')})`,
    );
  }
  if (!parser.script) throw new Error('local parser requires a `script` path under inputs/parsers/');
  const scriptAbs = resolve(root, expandParserArg(parser.script, apiInfo.careersUrl, company));
  if (scriptAbs !== parsersDir && !scriptAbs.startsWith(parsersDir + sep)) {
    throw new Error(`local parser script must resolve inside inputs/parsers/ (got ${parser.script})`);
  }
  if (!existsSync(scriptAbs)) throw new Error(`local parser script not found: ${parser.script}`);
  // The lexical check above is symlink-blind (resolve() doesn't follow links),
  // but execFile would follow one out of the tree. Canonicalize both sides and
  // re-check so a symlink inside inputs/parsers/ can't escape it. realpathSync
  // is taken relative to the same canonical parsersDir, so the OS-level tmp
  // symlinks (e.g. macOS /var→/private/var) cancel out.
  const realScript = realpathSync(scriptAbs);
  const realParsers = realpathSync(parsersDir);
  if (realScript !== realParsers && !realScript.startsWith(realParsers + sep)) {
    throw new Error(`local parser script must resolve inside inputs/parsers/ (got ${parser.script})`);
  }

  const args = [
    scriptAbs,
    ...(Array.isArray(parser.args) ? parser.args : []).map(a =>
      expandParserArg(a, apiInfo.careersUrl, company),
    ),
  ];
  const { stdout } = await execFileAsync(command, args, {
    timeout: Number(parser.timeout_ms) || LOCAL_PARSER_TIMEOUT_MS,
    maxBuffer: Number(parser.max_buffer_bytes) || LOCAL_PARSER_MAX_BUFFER,
    windowsHide: true,
    cwd: root,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error('local parser returned invalid JSON on stdout');
  }
}

// ── Dedup (identical to scan-jobspy.mjs) ────────────────────────────
function loadSeenUrls() {
  const seen = new Set();
  if (existsSync(SCAN_HISTORY_PATH)) {
    for (const line of readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n').slice(1)) {
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const m of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) seen.add(m[1]);
  }
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const m of text.matchAll(/https?:\/\/[^\s|)]+/g)) seen.add(m[0]);
  }
  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const m of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const c = m[1].trim().toLowerCase();
      const r = m[2].trim().toLowerCase();
      if (c && r && c !== 'company') seen.add(`${c}::${r}`);
    }
  }
  return seen;
}

// ── Pipeline / history writers (format-matched to scan-jobspy.mjs) ──
// Scraped titles/companies are untrusted feed content. Strip the characters
// that act as field/row delimiters downstream: `|` (pipeline.md fields, split
// by screen.mjs loadPending) and tab/newline (scan-history.tsv columns/rows) —
// mirroring the sanitization in pipeline-to-input.mjs.
const cleanField = s =>
  String(s || '')
    .replace(/[\t\n\r|]+/g, ' ')
    .trim();

function appendToPipeline(offers) {
  if (offers.length === 0) return;
  mkdirSync(`${ROOT}/data`, { recursive: true });
  let text = existsSync(PIPELINE_PATH)
    ? readFileSync(PIPELINE_PATH, 'utf-8')
    : '# Pipeline Inbox\n\n## Pending\n\n## Processed\n';

  const marker = '## Pending';
  const idx = text.indexOf(marker);
  const block =
    '\n' +
    offers.map(o => `- [ ] ${o.url} | ${cleanField(o.company)} | ${cleanField(o.title)}`).join('\n') +
    '\n';

  if (idx === -1) {
    text += `\n## Pending\n${block}`;
  } else {
    const next = text.indexOf('\n## ', idx + marker.length);
    const insertAt = next === -1 ? text.length : next;
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }
  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  mkdirSync(`${ROOT}/data`, { recursive: true });
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(
      SCAN_HISTORY_PATH,
      'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlogo\tposted\n',
      'utf-8',
    );
  }
  // `logo` column is empty for ATS feeds (no logo in the JSON). `posted` is
  // the true posting date the ATS reported (empty when the feed had none).
  // Both kept last so older 6/7-column history files stay readable.
  const lines =
    offers
      .map(o => `${o.url}\t${date}\t${o.source}\t${cleanField(o.title)}\t${cleanField(o.company)}\tadded\t\t${o.posted || ''}`)
      .join('\n') + '\n';
  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Concurrency-limited fetch ───────────────────────────────────────
async function parallelFetch(tasks, limit) {
  let i = 0;
  async function next() {
    while (i < tasks.length) await tasks[i++]();
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, next));
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  // Source gate — scanning.sources.ats defaults to ON: only an explicit
  // `false` disables the ATS scanner. Mirrors the JobSpy gate in
  // scan-jobspy.mjs. Lives in main() (not module scope) so importing the
  // parsers in unit tests never exits the process.
  const config = loadYaml(CONFIG_PATH);
  if (config?.scanning?.sources?.ats === false) {
    console.log('ATS portal scan disabled in settings (scanning.sources.ats = false) — skipping.');
    return;
  }

  // Graceful no-op when ATS is on but the user has no company list yet.
  if (!existsSync(PORTALS_PATH)) {
    console.log(
      'ATS portal scan enabled but inputs/personalization/portals.yml not found — skipping.',
    );
    console.log('Copy content/examples/personalization/portals.yml to add tracked companies.');
    return;
  }

  const portals = loadYaml(PORTALS_PATH);
  const companies = Array.isArray(portals.tracked_companies) ? portals.tracked_companies : [];
  if (companies.length === 0) {
    console.log('portals.yml has no tracked_companies — skipping ATS portal scan.');
    return;
  }

  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !FILTER_COMPANY || (c.name || '').toLowerCase().includes(FILTER_COMPANY))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);

  const enabledCount = companies.filter(c => c.enabled !== false).length;
  const skippedCount = enabledCount - targets.length;

  console.log(
    `Scanning ${targets.length} companies via ATS API` +
      (skippedCount > 0 ? ` (${skippedCount} skipped — no direct feed detected)` : ''),
  );
  if (DRY_RUN) console.log('(dry run — no files will be written)\n');

  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();
  const date = new Date().toISOString().slice(0, 10);

  let totalFound = 0;
  let totalFiltered = 0;
  let totalFilteredLocation = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];

  const tasks = targets.map(company => async () => {
    const { type, url } = company._api;
    try {
      // Local parser spawns a script (no URL fetch), so it skips the host
      // allowlist; every HTTP provider is host-validated before its fetch.
      if (type !== 'local') assertAtsUrl(url, type);
      const json =
        type === 'local'
          ? await fetchLocalParser(company._api, company.name)
          : type === 'workday'
            ? await fetchWorkdayAll(url)
            : type === 'smartrecruiters'
              ? await fetchSmartRecruitersAll(url)
              : await fetchJson(url);
      const jobs = PARSERS[type](json, company.name, company._api, date);
      totalFound += jobs.length;
      for (const job of jobs) {
        if (!job.url) continue;
        if (!titleMatches(job.title)) {
          totalFiltered++;
          continue;
        }
        if (!locationMatches(job.location)) {
          totalFilteredLocation++;
          continue;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        newOffers.push({ ...job, source: type === 'local' ? 'local-parser' : `${type}-api` });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  if (!DRY_RUN && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Portal Scan — ${date}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Companies scanned:  ${targets.length}`);
  console.log(`Total jobs found:   ${totalFound}`);
  console.log(`Filtered by title:    ${totalFiltered}`);
  console.log(`Filtered by location: ${totalFilteredLocation}`);
  console.log(`Duplicates:         ${totalDupes}`);
  console.log(`New offers added:   ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ ${e.company}: ${e.error}`);
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers.slice(0, 20)) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (newOffers.length > 20) console.log(`  … and ${newOffers.length - 20} more`);
    console.log(
      DRY_RUN
        ? '\n(dry run — run without --dry-run to save results)'
        : `\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`,
    );
  }

  console.log('\n→ Run /sur9e process-queue to screen new offers.');
}

// import.meta-main guard so importing the parsers (unit tests) never runs a
// real scan — mirrors batch/screen.mjs.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
