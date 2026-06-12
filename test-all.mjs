#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * test-all.mjs — Comprehensive test suite for sur9e
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, data contract, personal data, paths,
 *        report parsers, lint, type-check.
 *
 * Usage:
 *   node test-all.mjs           # Run all tests
 *   node test-all.mjs --quick   # Faster subset (skips slower checks)
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) {
  console.log(`  ✅ ${msg}`);
  passed++;
}
function fail(msg) {
  console.log(`  ❌ ${msg}`);
  failed++;
}
function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
  warnings++;
}

function run(cmd, args = [], opts = {}) {
  try {
    if (Array.isArray(args) && args.length > 0) {
      return execFileSync(cmd, args, {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30000,
        ...opts,
      }).trim();
    }
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (_e) {
    return null;
  }
}

function fileExists(path) {
  return existsSync(join(ROOT, path));
}
function readFile(path) {
  return readFileSync(join(ROOT, path), 'utf-8');
}

console.log('\n🧪 sur9e test suite\n');

// ── 1. SYNTAX CHECKS ────────────────────────────────────────────

console.log('1. Syntax checks');

const mjsFiles = readdirSync(ROOT).filter(f => f.endsWith('.mjs'));
for (const f of mjsFiles) {
  const result = run('node', ['--check', f]);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// CLI .mjs files
const cliFiles = [];
try {
  for (const f of readdirSync(join(ROOT, 'cli'))) {
    if (f.endsWith('.mjs')) cliFiles.push(`cli/${f}`);
  }
} catch {}
for (const f of cliFiles) {
  const result = run('node', ['--check', f]);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// ── 2. SCRIPT EXECUTION ─────────────────────────────────────────

console.log('\n2. Script execution (graceful on empty data)');

// Tracker scripts run with --dry-run: user data files (data/applications.md,
// batch/tracker-additions/) are immutable in test flows — the gate only
// verifies the scripts execute, it must never write.
const scripts = [
  { name: 'cli/cv-sync-check.mjs', allowFail: true }, // fails without cv.md (normal in repo)
  { name: 'cli/verify-pipeline.mjs' },
  { name: 'cli/normalize-statuses.mjs --dry-run' },
  { name: 'cli/dedup-tracker.mjs --dry-run' },
  { name: 'cli/merge-tracker.mjs --dry-run' },
  { name: 'update-system.mjs check' },
];

for (const { name, allowFail } of scripts) {
  const result = run('node', name.split(' '), { stdio: ['pipe', 'pipe', 'pipe'] });
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail) {
    warn(`${name} exited with error (expected without user data)`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 3. LIVENESS CLASSIFICATION ──────────────────────────────────
// Covered by vitest suite (src/lib/server/__tests__/liveness-core.test.ts) —
// runs via Section 16's `npx vitest run` below.

// ── 5. DATA CONTRACT ────────────────────────────────────────────

console.log('\n5. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md',
  'VERSION',
  'content/modes/_shared.md',
  'content/examples/personalization/narrative.md',
  'content/modes/evaluate.md',
  'content/modes/tailor-cv.md',
  'content/templates/states.yml',
  'content/templates/cv-template.html',
  '.claude/skills/sur9e/SKILL.md',
  'content/examples/personalization/profile.yml',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

// Check user files are NOT tracked (gitignored)
const userFiles = [
  'inputs/personalization/profile.yml',
  'inputs/personalization/narrative.md',
  'inputs/personalization/cv.md',
  'inputs/personalization/article-digest.md',
];
for (const f of userFiles) {
  const tracked = run('git', ['ls-files', f]);
  if (tracked === '') {
    pass(`User file gitignored: ${f}`);
  } else if (tracked === null) {
    pass(`User file gitignored: ${f}`);
  } else {
    fail(`User file IS tracked (should be gitignored): ${f}`);
  }
}

// ── 6. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n6. Personal data leak check');

// Strings that should never reach a tracked file (your home path, phone,
// or any user-data fingerprint). Personal patterns live in the gitignored
// inputs/config/leak-patterns.txt (one per line, # for comments) — never
// hardcode them here: this file is tracked, so the patterns themselves
// would become the leak. Section 7's absolute-path check stays as the
// tracked, generic backstop for home paths.
const leakPatternsFile = join(ROOT, 'inputs/config/leak-patterns.txt');
const leakPatterns = existsSync(leakPatternsFile)
  ? readFileSync(leakPatternsFile, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
  : [];

const scanExtensions = ['md', 'yml', 'html', 'mjs', 'sh', 'go', 'json'];
const allowedFiles = [
  // Files where personal-data exceptions are intentional (LICENSE has
  // upstream MIT-required copyright; package.json has maintainer/homepage
  // data; go.mod is an internal module path)
  'LICENSE',
  'package.json',
  'go.mod',
];

// Build pathspec for git grep — only scan tracked files matching these
// extensions. This is what `grep -rn` was trying to do, but git-aware:
// untracked files (debate artifacts, AI tool scratch, local plans/) and
// gitignored files can't trigger false positives because they were never
// going to reach a commit anyway.
const grepPathspec = scanExtensions.map(e => `'*.${e}'`).join(' ');

let leakFound = false;
for (const pattern of leakPatterns) {
  const result = run(`git grep -n "${pattern}" -- ${grepPathspec} 2>/dev/null`);
  if (result) {
    for (const line of result.split('\n')) {
      const file = line.split(':')[0];
      if (allowedFiles.some(a => file.includes(a))) continue;
      fail(`Personal data in ${file}: "${pattern}"`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No personal data leaks outside allowed files');
}

// ── 7. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n7. Absolute path check');

// Same git grep approach: only scans tracked files. Untracked AI tool
// outputs, local debate artifacts, etc. can't false-positive here.
// Markdown files are documentation — example paths are intentional. Only
// flag absolute paths in actual code/config files that get executed.
const absPathResult = run(
  `git grep -n "/Users/" -- '*.mjs' '*.sh' '*.go' '*.yml' 2>/dev/null | grep -v README.md | grep -v LICENSE | grep -v CLAUDE.md | grep -v test-all.mjs`,
);
if (!absPathResult) {
  pass('No absolute paths in code files');
} else {
  for (const line of absPathResult.split('\n').filter(Boolean)) {
    fail(`Absolute path: ${line.slice(0, 100)}`);
  }
}

// ── 8. MODE FILE INTEGRITY ──────────────────────────────────────

console.log('\n8. Mode file integrity');

const expectedModes = [
  '_shared.md',
  'evaluate.md',
  'tailor-cv.md',
  'batch-evaluate.md',
  'apply.md',
  'evaluate-offer.md',
  'reach-out.md',
  'research.md',
  'offers.md',
  'process-queue.md',
  'project.md',
  'tracker.md',
  'training.md',
];

for (const mode of expectedModes) {
  if (fileExists(`content/modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

// Check _shared.md points the model at the canonical profile source.
// (Was `_profile.md`, a legacy filename that no longer exists; the profile
// now lives in inputs/personalization/profile.yml.)
const shared = readFile('content/modes/_shared.md');
if (shared.includes('profile.yml')) {
  pass('_shared.md references the profile source (profile.yml)');
} else {
  fail('_shared.md does NOT reference the profile source (profile.yml)');
}

// ── 9. CLAUDE.md INTEGRITY ──────────────────────────────────────

console.log('\n9. CLAUDE.md integrity');

const claude = readFile('CLAUDE.md');

// CLAUDE.md is the index — must reference each domain doc.
// Domain content lives in docs/ files; this section asserts the
// links exist so a renamed/missing doc is caught at test time.
// (docs/strategy.md removed 2026-06-06 — internal planning docs no
// longer referenced from public files.)
const requiredDocRefs = [
  'docs/data-contract.md',
  'docs/onboarding.md',
  'docs/architecture.md',
  'docs/setup.md',
  'docs/customization.md',
];

for (const ref of requiredDocRefs) {
  if (claude.includes(ref)) {
    pass(`CLAUDE.md references: ${ref}`);
  } else {
    fail(`CLAUDE.md missing reference: ${ref}`);
  }
}

// CLAUDE.md must contain the protocol that fires every session start
const requiredProtocols = ['update-system.mjs check', 'Update check'];
for (const p of requiredProtocols) {
  if (claude.includes(p)) {
    pass(`CLAUDE.md has protocol: ${p}`);
  } else {
    fail(`CLAUDE.md missing protocol: ${p}`);
  }
}

// Each referenced domain doc must actually exist on disk.
for (const ref of requiredDocRefs) {
  if (existsSync(ref)) {
    pass(`Domain doc exists: ${ref}`);
  } else {
    fail(`Domain doc missing on disk: ${ref}`);
  }
}

// CLAUDE.md and AGENTS.md carry the same operating manual for different
// agent runtimes — they must stay byte-identical so neither drifts.
if (readFile('AGENTS.md') === claude) {
  pass('AGENTS.md is in sync with CLAUDE.md');
} else {
  fail(
    'AGENTS.md has drifted from CLAUDE.md (the two must stay identical — copy one over the other)',
  );
}

// Tracked files must not reference maintainer-internal planning docs — even
// naming them (e.g. in .gitignore) advertises their existence. The private
// paths are ignored per-clone via .git/info/exclude + .prettierignore.local,
// never via the tracked .gitignore. Only this file may name the patterns
// (it is the check).
const internalRefPatterns = [
  'docs/strategy.md',
  'docs/superpowers/',
  'docs/archive/',
  'CLAUDE.local.md',
  '.claude/superpowers/',
  '\\.superpowers/',
];
for (const pattern of internalRefPatterns) {
  const hits = run('bash', [
    '-c',
    `git grep -l "${pattern}" -- . ':!test-all.mjs' 2>/dev/null || true`,
  ]);
  if (!hits || hits.trim() === '') {
    pass(`No public reference to internal docs: ${pattern}`);
  } else {
    fail(
      `Tracked files reference internal doc path ${pattern}: ${hits.trim().split('\n').join(', ')}`,
    );
  }
}

// ── 11. WEB STATIC ASSETS ───────────────────────────────────────
// Retired: legacy vanilla pages were replaced by Next routes under app/*.
// Static asset presence is now validated by `next build` (batch 6+).

// ── 12. PARSER FIXTURES + SCHEMA INVARIANTS ────────────────────
// Retired. Liveness, report parsers, schema validators previously
// dynamic-imported the .mjs runtime here; they now live as vitest
// suites in src/lib/server/__tests__/*.test.ts and run via Section 16
// below (which executes `npx vitest run` with no path filter — the
// vitest config's `src/server/lib/**` include already covers them).

// ── 10. VERSION FILE ─────────────────────────────────────────────

console.log('\n10. Version file');

if (fileExists('VERSION')) {
  const version = readFile('VERSION').trim();
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }
} else {
  fail('VERSION file missing');
}

// ── 13. CREDENTIAL LEAK GUARD ─────────────────────────────────────
//
// Greps tracked files for credential prefixes that should never be in source.
// Pattern set is conservative: real keys, no false-positive-prone substrings.

console.log('\n13. Credential leak guard');

const credentialPatterns = [
  { name: 'Anthropic key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI key', re: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'Slack bot token', re: /xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+/ },
  { name: 'GitHub PAT', re: /ghp_[A-Za-z0-9]{30,}/ },
  { name: 'GitHub fine-grained', re: /github_pat_[A-Za-z0-9_]{40,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
];

try {
  const tracked = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n');
  let leaks = 0;
  for (const file of tracked) {
    if (!fileExists(file)) continue;
    // Skip the test file itself (contains the regex patterns)
    if (file === 'test-all.mjs') continue;
    // Skip lock files / binaries
    if (/\.(lock|png|jpg|jpeg|gif|pdf|woff|woff2|ttf|otf)$/i.test(file)) continue;
    let content;
    try {
      content = readFile(file);
    } catch (_e) {
      continue;
    }
    for (const pat of credentialPatterns) {
      if (pat.re.test(content)) {
        fail(`${pat.name} pattern in ${file}`);
        leaks++;
      }
    }
  }
  if (leaks === 0) pass(`No credential prefixes found across ${tracked.length} tracked files`);
} catch (e) {
  warn(`Credential scan skipped: ${e.message}`);
}

// =============================================================================
// 14. PIPELINE FILTERS — pure-function state module
// =============================================================================
// [14/N] Pipeline filters — RETIRED. Logic now lives in
// features/table/table-url-state.ts and is covered by vitest
// (`npm run test:unit`). Originally tested public/js/pipeline-filters.mjs.
// =============================================================================

// =============================================================================
// 15 + 16. STATUS MUTATION + APPLICATION DELETE
// Covered by vitest suite (src/lib/server/__tests__/applications-schema.test.ts) —
// runs via Section 16's `npx vitest run` below.
// =============================================================================

// [17] Selection state module — RETIRED. Vanilla public/selection-state.js was
// replaced by Zustand store in stores/selection-store.ts; vitest covers parity.

// [18] Analytics module — covered by vitest (src/lib/server/__tests__/analytics.test.ts).
// Usage-tracker + stream-claude-parser below test CLI files that stay as .mjs.
{
  // usage-tracker — RATES table covers Haiku, Sonnet, Opus
  const ut = await import('./cli/usage-tracker.mjs');
  if (
    typeof ut.RATES === 'object' &&
    ut.RATES['claude-haiku-4-5']?.input === 0.8 &&
    ut.RATES['claude-sonnet-4-6']?.input === 3.0 &&
    ut.RATES['claude-opus-4-7']?.input === 15.0
  ) {
    console.log('  ✓ usage-tracker: RATES export covers haiku/sonnet/opus');
    passed++;
  } else {
    console.log(
      `  ❌ usage-tracker: RATES export missing models. got: ${JSON.stringify(Object.keys(ut.RATES || {}))}`,
    );
    failed++;
  }

  // computeCostFromTokens — fallback path when callers don't pass cost_usd
  if (ut.computeCostFromTokens) {
    const haikuCost = ut.computeCostFromTokens(1000000, 100000, 'claude-haiku-4-5');
    // 1M * 0.80 + 0.1M * 4.00 = 0.80 + 0.40 = 1.20
    if (Math.abs(haikuCost - 1.2) < 0.001) {
      console.log('  ✓ usage-tracker: computeCostFromTokens haiku');
      passed++;
    } else {
      console.log(`  ❌ haiku cost: expected 1.20, got ${haikuCost}`);
      failed++;
    }

    const sonnetCost = ut.computeCostFromTokens(1000000, 100000, 'claude-sonnet-4-6');
    // 1M * 3.00 + 0.1M * 15.00 = 3.00 + 1.50 = 4.50
    if (Math.abs(sonnetCost - 4.5) < 0.001) {
      console.log('  ✓ usage-tracker: computeCostFromTokens sonnet');
      passed++;
    } else {
      console.log(`  ❌ sonnet cost: expected 4.50, got ${sonnetCost}`);
      failed++;
    }

    const opusCost = ut.computeCostFromTokens(1000000, 100000, 'claude-opus-4-7');
    // 1M * 15.00 + 0.1M * 75.00 = 15.00 + 7.50 = 22.50
    if (Math.abs(opusCost - 22.5) < 0.001) {
      console.log('  ✓ usage-tracker: computeCostFromTokens opus');
      passed++;
    } else {
      console.log(`  ❌ opus cost: expected 22.50, got ${opusCost}`);
      failed++;
    }

    // Unknown model — fallback to sonnet rates with a warning
    const unknownCost = ut.computeCostFromTokens(1000000, 100000, 'claude-future-99');
    if (Math.abs(unknownCost - 4.5) < 0.001) {
      console.log('  ✓ usage-tracker: unknown model falls back to sonnet rate');
      passed++;
    } else {
      console.log(`  ❌ unknown model fallback: expected 4.50, got ${unknownCost}`);
      failed++;
    }
  } else {
    console.log('  ❌ usage-tracker: computeCostFromTokens not exported');
    failed++;
  }

  // dead code stripped — trackScrapingdog must NOT exist
  if (typeof ut.trackScrapingdog === 'undefined') {
    console.log('  ✓ usage-tracker: trackScrapingdog removed');
    passed++;
  } else {
    console.log('  ❌ usage-tracker: trackScrapingdog still exported (dead code)');
    failed++;
  }

  // stream-claude-parser emits [USAGE] marker on result event
  const { spawn } = await import('child_process');
  const ndjsonInput = [
    '{"type":"system","subtype":"init","session_id":"abc","model":"claude-sonnet-4-6"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"duration_ms":12000,"num_turns":3,"total_cost_usd":0.42,"usage":{"input_tokens":1500,"output_tokens":250},"model":"claude-sonnet-4-6"}',
  ].join('\n');

  const out = await new Promise((resolve, reject) => {
    const child = spawn('node', ['cli/stream-claude-parser.mjs'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let buf = '';
    child.stdout.on('data', d => {
      buf += d.toString();
    });
    child.on('exit', () => resolve(buf));
    child.on('error', reject);
    child.stdin.write(ndjsonInput);
    child.stdin.end();
  });

  if (out.includes('[USAGE] {')) {
    const usageLine = out.split('\n').find(l => l.startsWith('[USAGE] '));
    const usagePayload = JSON.parse(usageLine.slice('[USAGE] '.length));
    if (
      usagePayload.cost_usd === 0.42 &&
      usagePayload.input_tokens === 1500 &&
      usagePayload.output_tokens === 250 &&
      usagePayload.model === 'claude-sonnet-4-6'
    ) {
      console.log('  ✓ stream-claude-parser: emits [USAGE] marker on result event');
      passed++;
    } else {
      console.log(`  ❌ stream-claude-parser: [USAGE] payload wrong: ${usageLine}`);
      failed++;
    }
  } else {
    console.log('  ❌ stream-claude-parser: no [USAGE] line in output');
    failed++;
  }

  // jobs.mjs USAGE-line extraction logic — pure regex, easy to test
  const sampleOutput = [
    '[1/4] Loading offer #1272 (https://...)',
    '[2/4] Running full evaluation...',
    '✓ claude done — 18 turns, $0.42, 7m12s',
    '[USAGE] {"cost_usd":0.42,"input_tokens":1500,"output_tokens":250,"model":"claude-sonnet-4-6"}',
    '[3/4] Merging the new report into the tracker (re-eval mode, num=1272)',
    '[4/4] Done',
  ].join('\n');
  const usageLine = sampleOutput
    .split('\n')
    .reverse()
    .find(l => l.startsWith('[USAGE] '));
  if (usageLine) {
    const parsed = JSON.parse(usageLine.slice('[USAGE] '.length));
    if (parsed.cost_usd === 0.42) {
      console.log('  ✓ jobs: [USAGE] line extraction');
      passed++;
    } else {
      console.log(`  ❌ jobs: [USAGE] parse wrong: ${JSON.stringify(parsed)}`);
      failed++;
    }
  } else {
    console.log('  ❌ jobs: [USAGE] line not found in sample output');
    failed++;
  }
}

// [19] Settings module — covered by vitest (src/lib/server/__tests__/settings-schema.test.ts).

// [20] FIELD_HELP integrity — RETIRED. The FIELD_HELP map moved into
// features/profile/* during the React migration; integrity is now enforced by
// TypeScript types and vitest coverage of the profile form components.

// ── 13. LINT + FORMAT (Biome + Prettier) ────────────────────────

console.log('\n13. Lint + format (Biome + Prettier)');

// Gate uses `biome check` (lint + format + organize-imports) and
// `prettier --check` so the local gate fails on the same drift CI fails
// on. Capturing stdout/stderr so failures show the offending line range
// instead of just "errors — run npx biome to see them".
if (existsSync(join(ROOT, 'node_modules/@biomejs/biome/bin/biome'))) {
  try {
    execFileSync('node', ['node_modules/@biomejs/biome/bin/biome', 'check', '.'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: 'pipe',
    });
    pass('Biome check clean (lint + format + imports)');
  } catch (e) {
    if (e.stdout) process.stderr.write(String(e.stdout));
    if (e.stderr) process.stderr.write(String(e.stderr));
    fail('Biome check failed (output above) — run `npm run lint` or `biome check --write`');
  }
} else {
  warn('Biome not installed (run `npm install`) — skipping');
}

if (existsSync(join(ROOT, 'node_modules/.bin/prettier'))) {
  try {
    // Explicit --ignore-path list: passing --ignore-path replaces the
    // defaults (.prettierignore + .gitignore), so those two are restated
    // and .prettierignore.local (per-clone, untracked, optional — Prettier
    // tolerates a missing ignore file) is added for local-only excludes.
    execFileSync(
      'npx',
      [
        'prettier',
        '--check',
        '**/*.{md,yml,yaml}',
        '--ignore-path',
        '.prettierignore',
        '--ignore-path',
        '.gitignore',
        '--ignore-path',
        '.prettierignore.local',
      ],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 60000,
        stdio: 'pipe',
      },
    );
    pass('Prettier --check clean (md/yml/yaml)');
  } catch (e) {
    if (e.stdout) process.stderr.write(String(e.stdout));
    if (e.stderr) process.stderr.write(String(e.stderr));
    fail('Prettier --check failed (output above) — run `npm run format`');
  }
} else {
  warn('Prettier not installed (run `npm install`) — skipping');
}

// ── 14. ACTION BAR CONFIG — RETIRED ─────────────────────────────
// STATUS_ACTIONS / MODE_REGISTRY moved to features/report/report-toolbar-config.ts
// and are exercised by vitest (`npm run test:unit`). Originally validated
// public/report-toolbar-config.js.

// ── UNIT TESTS — RETIRED ────────────────────────────────────────
// node --test on .test.mjs files is gone. All converted to vitest
// .test.ts in Phase 2 of the scaffolding cleanup; vitest now runs
// the full suite (see Section 16 below + npm run test:unit).

// ── A11Y AUDIT (axe-core, WCAG 2.2 AA) ──────────────────────────
// Skipped in --quick (Playwright + 6 page loads ~10-15s — too slow
// for the pre-commit gate). Runs in full `npm run test` and CI.
// Passes if zero auto-fixable rules fail, so a future commit can't
// silently regress aria-allowed-attr / role / region / etc. Human-
// judgment rules (color-contrast, target-size, vendor markup) surface
// as warnings but don't fail.

if (!QUICK) {
  console.log('\n. Accessibility audit (axe-core, WCAG 2.2 AA)');
  if (!existsSync(join(ROOT, 'node_modules/axe-core/axe.min.js'))) {
    warn('axe-core not installed — run `npm install` then retry');
  } else if (!existsSync(join(ROOT, 'node_modules/playwright'))) {
    warn('playwright not installed — skipping a11y audit');
  } else {
    // The audit exits 1 when violations exist (normal — we still want
    // the JSON to decide auto vs human). execFileSync throws on
    // non-zero but populates err.stdout, so we accept either path.
    // The audit output runs ~700KB and the audit exits 1 when it finds
    // violations (normal). execFileSync's err.stdout caps at 64KB on
    // some platforms when the child throws, which would clip mid-JSON.
    // Workaround: write to a temp file via --output, then read it back.
    const TMP = join(ROOT, '.tmp-a11y-audit.json');
    try {
      execFileSync('node', ['cli/a11y-audit.mjs', '--no-server', '--json', '--output', TMP], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 60000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // Non-zero exit is expected when violations exist; the file is
      // still written. Only crash (exit 2) leaves no file behind.
    }
    if (existsSync(TMP)) {
      const jsonText = readFileSync(TMP, 'utf-8');
      try {
        inspectA11y(jsonText);
      } finally {
        try {
          execFileSync('rm', ['-f', TMP], { cwd: ROOT, stdio: 'ignore' });
        } catch {
          /* ignore cleanup error */
        }
      }
    } else {
      fail('a11y audit produced no output file (likely crashed before writing)');
    }
  }
}

function inspectA11y(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    fail(`a11y audit produced invalid JSON: ${e.message.slice(0, 120)}`);
    return;
  }
  let autoCount = 0;
  let humanCount = 0;
  const autoRules = new Set();
  const humanRules = new Set();
  for (const page of data.pages || []) {
    for (const v of page.violations || []) {
      const cat = v.category || 'human';
      const occ = (v.nodes || []).length;
      if (cat === 'auto') {
        autoCount += occ;
        autoRules.add(v.id);
      } else {
        humanCount += occ;
        humanRules.add(v.id);
      }
    }
  }
  if (autoCount === 0) {
    pass(`No auto-fixable WCAG 2.2 AA violations across ${(data.pages || []).length} pages`);
  } else {
    fail(
      `${autoCount} auto-fixable a11y violation${autoCount === 1 ? '' : 's'} across rules: ${[...autoRules].sort().join(', ')} — run \`node cli/a11y-audit.mjs\` for details`,
    );
  }
  if (humanCount > 0) {
    warn(
      `${humanCount} human-judgment a11y finding${humanCount === 1 ? '' : 's'} (rules: ${[...humanRules].sort().join(', ')}) — review manually`,
    );
  }
}

// ── 15. TYPE-CHECK (Next + server JSDoc) ────────────────────────

console.log('\n15. Type-check (Next + server JSDoc)');

if (existsSync(join(ROOT, 'node_modules/typescript/bin/tsc'))) {
  const tscOut = run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
    timeout: 120000,
  });
  if (tscOut !== null) {
    pass('tsc (Next/React surface) clean');
  } else {
    fail('tsc (Next/React) reported type errors — run `npm run typecheck` to see them');
  }
} else {
  warn('TypeScript not installed (run `npm install`) — skipping');
}

// ── 16. VITEST (React unit tests) ──────────────────────────────

console.log('\n16. Vitest (React unit tests)');

if (existsSync(join(ROOT, 'node_modules/.bin/vitest'))) {
  // Capture vitest output so the failure detail prints on failure
  // (the wrapper's run() helper otherwise swallows stderr).
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=dot', '--passWithNoTests'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 600000,
      stdio: 'pipe',
    });
    pass('vitest clean (or no test files yet)');
  } catch (e) {
    if (e.stdout) process.stderr.write(String(e.stdout));
    if (e.stderr) process.stderr.write(String(e.stderr));
    if (e.signal === 'SIGTERM' && e.status == null) {
      fail(
        'vitest killed by the 600s wrapper timeout — not a test failure; the suite outgrew the limit',
      );
    } else {
      fail('vitest reported failures (output above)');
    }
  }
} else {
  warn('vitest not installed (run `npm install`) — skipping');
}

// ── 16b. LINT-REPORTS (report-markdown contract over fixtures) ──
// Runs the report-markdown validators over test/fixtures/reports/*.md only —
// never data/ or artifacts/ (user files). Positive (golden) fixtures must be
// clean; `dirty-*` negative fixtures must trip an error. Part of --quick.

console.log('\n16b. Report-markdown contract (lint-reports over fixtures)');

if (fileExists('cli/lint-reports.mjs')) {
  try {
    execFileSync('node', ['cli/lint-reports.mjs'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 90000,
      stdio: 'pipe',
    });
    pass('lint-reports clean (report-markdown contract holds over fixtures)');
  } catch (e) {
    if (e.stdout) process.stderr.write(String(e.stdout));
    if (e.stderr) process.stderr.write(String(e.stderr));
    fail('lint-reports reported contract violations (output above)');
  }
} else {
  warn('cli/lint-reports.mjs missing — skipping report-markdown contract check');
}

// ── 17. E2E (Playwright, only when test/e2e/* specs exist) ───────
if (!QUICK && existsSync(join(ROOT, 'test/e2e'))) {
  const list = run('npx', ['playwright', 'test', '--list'], { timeout: 30000 });
  const hasSpecs = list !== null && /Total:\s+[1-9]/.test(list);
  if (hasSpecs) {
    console.log('\n17. E2E smoke gate (Playwright)');
    const e2eOut = run('npm run test:e2e:ci', [], { timeout: 300000 });
    if (e2eOut !== null) {
      pass('Playwright e2e smoke gate passed');
    } else {
      fail('Playwright e2e reported failures — run `npm run test:e2e` to see them');
    }
  }
}

// ── SUMMARY ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 All tests passed — safe to push/merge\n');
  process.exit(0);
}
