#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// src/cli/a11y-audit.mjs
// WCAG 2.2 AA audit using axe-core injected via Playwright Chromium.
//
// Usage:
//   node src/cli/a11y-audit.mjs                  → human-readable report
//   node src/cli/a11y-audit.mjs --json           → JSON, one object per page
//   node src/cli/a11y-audit.mjs --json --output a11y.json
//   node src/cli/a11y-audit.mjs --pages "report/1,pipeline"
//   node src/cli/a11y-audit.mjs --no-server      → assume Next dev server already up at :3001
//
// Exit code:
//   0  no violations
//   1  any WCAG 2.2 AA violation found
//   2  audit could not run (server unreachable, axe-core missing, etc.)

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AXE_PATH = join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
const PORT = 3001;
const ORIGIN = `http://127.0.0.1:${PORT}`;

// Routes mirror the Next app shell post-migration. Each path
// resolves through the React routes under app/*; no legacy *.html paths.
const DEFAULT_PAGES = [
  'pipeline',
  'table',
  'analytics',
  'profile',
  'settings',
  // Picks the first available report numerically; can be overridden via --pages
  // if no report-1 exists in the local data dir.
  'report/1',
];

// Map each axe rule we care about to a fix category. "auto" means a
// mechanical fix (add attribute, swap element, dedupe id). "human" means
// the fix requires a design or content decision (pick a new color, write
// a meaningful label, decide whether a heading should exist).
const FIX_CATEGORY = {
  // ───── Auto-fixable ─────────────────────────────────────────────
  'aria-allowed-attr': 'auto',
  'aria-allowed-role': 'auto',
  'aria-deprecated-role': 'auto',
  'aria-hidden-body': 'auto',
  'aria-hidden-focus': 'auto',
  'aria-prohibited-attr': 'auto',
  'aria-required-attr': 'auto',
  'aria-roles': 'auto',
  'aria-valid-attr': 'auto',
  'aria-valid-attr-value': 'auto',
  'aria-conditional-attr': 'auto',
  'aria-progressbar-name': 'auto',
  'autocomplete-valid': 'auto',
  'document-title': 'auto',
  'duplicate-id': 'auto',
  'duplicate-id-active': 'auto',
  'duplicate-id-aria': 'auto',
  'frame-title': 'auto',
  'html-has-lang': 'auto',
  'html-lang-valid': 'auto',
  'html-xml-lang-mismatch': 'auto',
  landmark: 'auto',
  'landmark-banner-is-top-level': 'auto',
  'landmark-complementary-is-top-level': 'auto',
  'landmark-contentinfo-is-top-level': 'auto',
  'landmark-main-is-top-level': 'auto',
  'landmark-no-duplicate-banner': 'auto',
  'landmark-no-duplicate-contentinfo': 'auto',
  'landmark-no-duplicate-main': 'auto',
  'landmark-one-main': 'auto',
  'landmark-unique': 'auto',
  'meta-viewport': 'auto',
  'meta-viewport-large': 'auto',
  'nested-interactive': 'auto',
  'no-autoplay-audio': 'auto',
  region: 'auto',
  'role-img-alt': 'auto',
  'scope-attr-valid': 'auto',
  'scrollable-region-focusable': 'auto',
  'select-name': 'auto',
  'svg-img-alt': 'auto',
  tabindex: 'auto',
  'td-headers-attr': 'auto',
  'th-has-data-cells': 'auto',
  'valid-lang': 'auto',
  // ───── Human judgment required ──────────────────────────────────
  bypass: 'human', // skip-link copy/placement
  'color-contrast': 'human',
  'color-contrast-enhanced': 'human',
  'empty-heading': 'human',
  'form-field-multiple-labels': 'human',
  'heading-order': 'human',
  'image-alt': 'human', // need to know if it's decorative
  'image-redundant-alt': 'human',
  'input-button-name': 'human',
  'input-image-alt': 'human',
  label: 'human',
  'label-content-name-mismatch': 'human',
  'link-in-text-block': 'human',
  'link-name': 'human',
  'meta-refresh': 'human',
  'meta-refresh-no-exceptions': 'human',
  'page-has-heading-one': 'human',
  'presentation-role-conflict': 'human',
  'target-size': 'human', // sometimes data-driven (icon size from design)
  list: 'human',
  listitem: 'human',
  marquee: 'human',
  'object-alt': 'human',
  'video-caption': 'human',
};

function classify(ruleId) {
  return FIX_CATEGORY[ruleId] || 'human';
}

// ─── CLI parsing ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const FLAG = name => args.includes(name);
const VAL = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const JSON_OUT = FLAG('--json');
const NO_SERVER = FLAG('--no-server');
const OUTPUT = VAL('--output');
const PAGES_ARG = VAL('--pages');
const PAGES = PAGES_ARG ? PAGES_ARG.split(',') : DEFAULT_PAGES;

// ─── Server bootstrap ─────────────────────────────────────────────
let serverProc = null;
async function ensureServer() {
  if (NO_SERVER) return;
  try {
    const r = await fetch(`${ORIGIN}/`).catch(() => null);
    if (r && r.status < 500) return; // already up
  } catch {}
  process.stderr.write('[a11y] starting Next dev server…\n');
  serverProc = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  // Next dev compilation can take well over 6s on cold cache (the migration
  // bundle pulls in React + tiptap + tanstack). Allow up to 60s before giving up.
  for (let i = 0; i < 600; i++) {
    await new Promise(r => setTimeout(r, 100));
    try {
      const r = await fetch(`${ORIGIN}/`);
      if (r.status < 500) return;
    } catch {}
  }
  throw new Error('Next dev server failed to start within 60s');
}

function shutdownServer() {
  if (serverProc && !serverProc.killed) serverProc.kill();
}

// ─── Audit one page ───────────────────────────────────────────────
async function auditPage(browser, path) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', () => {}); // keep stdout clean
  page.on('console', () => {});

  await page.goto(`${ORIGIN}/${path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  // Give editors / TocRail / etc. time to mount.
  await page.waitForTimeout(1500);

  const axeSrc = readFileSync(AXE_PATH, 'utf8');
  await page.addScriptTag({ content: axeSrc });

  // axe-core is injected into the browser context above via addScriptTag;
  // dereference through globalThis so the linter doesn't read it as a
  // Node-side undeclared variable.
  const result = await page.evaluate(async () => {
    return await globalThis.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
      resultTypes: ['violations', 'incomplete'],
    });
  });

  await ctx.close();
  return { path, ...result };
}

// ─── Report rendering ─────────────────────────────────────────────
function renderTextReport(perPage) {
  const lines = [];
  let totalViolations = 0;
  const byRule = new Map();
  const allIncomplete = new Map();

  for (const page of perPage) {
    for (const v of page.violations || []) {
      totalViolations += v.nodes.length;
      const entry = byRule.get(v.id) || {
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        category: classify(v.id),
        nodes: [],
      };
      for (const n of v.nodes)
        entry.nodes.push({
          page: page.path,
          target: n.target.join(' > '),
          html: n.html.slice(0, 220),
          failureSummary: n.failureSummary,
        });
      byRule.set(v.id, entry);
    }
    for (const v of page.incomplete || []) {
      const entry = allIncomplete.get(v.id) || {
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: [],
      };
      for (const n of v.nodes) entry.nodes.push({ page: page.path, target: n.target.join(' > ') });
      allIncomplete.set(v.id, entry);
    }
  }

  // Group by fix category, then by rule.
  const auto = [...byRule.values()]
    .filter(r => r.category === 'auto')
    .sort((a, b) => a.id.localeCompare(b.id));
  const human = [...byRule.values()]
    .filter(r => r.category === 'human')
    .sort((a, b) => a.id.localeCompare(b.id));

  lines.push(`# WCAG 2.2 AA audit — axe-core`);
  lines.push('');
  lines.push(`Pages scanned: ${perPage.length}`);
  lines.push(`Violations (occurrences): ${totalViolations}`);
  lines.push(`Distinct rules failed: ${byRule.size}`);
  lines.push(`  auto-fixable: ${auto.length}`);
  lines.push(`  human-judgment: ${human.length}`);
  lines.push(
    `Incomplete (axe couldn't decide): ${[...allIncomplete.values()].reduce((n, r) => n + r.nodes.length, 0)}`,
  );
  lines.push('');

  function dumpRule(r) {
    const impact = r.impact ? ` (${r.impact})` : '';
    lines.push(`### ${r.id}${impact}`);
    lines.push(r.help);
    if (r.helpUrl) lines.push(`<${r.helpUrl}>`);
    lines.push('');
    const seen = new Set();
    for (const n of r.nodes.slice(0, 8)) {
      const key = `${n.page} ${n.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- ${n.page} → \`${n.target}\``);
    }
    if (r.nodes.length > 8) lines.push(`- … +${r.nodes.length - 8} more occurrences`);
    lines.push('');
  }

  if (auto.length) {
    lines.push('---');
    lines.push('## Auto-fixable (mechanical change)');
    lines.push('');
    auto.forEach(dumpRule);
  }
  if (human.length) {
    lines.push('---');
    lines.push('## Human-judgment (design/content decision)');
    lines.push('');
    human.forEach(dumpRule);
  }
  if (allIncomplete.size) {
    lines.push('---');
    lines.push('## Incomplete (manual review needed)');
    lines.push('');
    for (const r of allIncomplete.values()) {
      lines.push(
        `- ${r.id} — ${r.help} (${r.nodes.length} node${r.nodes.length === 1 ? '' : 's'})`,
      );
    }
  }

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await ensureServer();
  const browser = await chromium.launch({ headless: true });
  const perPage = [];
  try {
    for (const path of PAGES) {
      process.stderr.write(`[a11y] auditing ${path}…\n`);
      perPage.push(await auditPage(browser, path));
    }
  } finally {
    await browser.close();
    shutdownServer();
  }

  const totalViolations = perPage.reduce(
    (n, p) => n + (p.violations || []).reduce((m, v) => m + v.nodes.length, 0),
    0,
  );

  if (JSON_OUT) {
    const blob = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pages: perPage.map(p => ({
          path: p.path,
          url: p.url,
          violations: (p.violations || []).map(v => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            helpUrl: v.helpUrl,
            tags: v.tags,
            category: classify(v.id),
            nodes: v.nodes.map(n => ({
              target: n.target,
              html: n.html,
              failureSummary: n.failureSummary,
            })),
          })),
          incomplete: (p.incomplete || []).map(v => ({
            id: v.id,
            help: v.help,
            nodes: v.nodes.map(n => ({ target: n.target })),
          })),
        })),
      },
      null,
      2,
    );
    if (OUTPUT) writeFileSync(OUTPUT, blob);
    else process.stdout.write(blob + '\n');
  } else {
    const text = renderTextReport(perPage);
    if (OUTPUT) writeFileSync(OUTPUT, text);
    else process.stdout.write(text + '\n');
  }

  process.exit(totalViolations > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[a11y] failed:', err.message);
  shutdownServer();
  process.exit(2);
});
