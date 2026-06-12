// SPDX-License-Identifier: MIT
// scripts/lighthouse-baseline.mjs
//
// Capture a Lighthouse baseline against the Next.js app so
// future regressions are visible. Iterates the key routes, runs Lighthouse
// against each via the Node API, and emits:
//   - artifacts/lighthouse/<slug>.report.json   (raw lighthouse output)
//   - artifacts/lighthouse/<slug>.report.html   (visual report)
//   - artifacts/lighthouse/summary.json         (machine-readable summary)
//
// Modes:
//   --mode=prod   Build the app (if needed), start `next start -p 3001`,
//                 run Lighthouse, stop the server. This is the default and
//                 the only mode that yields a meaningful Performance number.
//   --mode=dev    Attach to an already-running `next dev -p 3001` (or start
//                 one if missing). Dev-mode Perf/LCP/TBT are noisy — useful
//                 for sanity checks, not for regression baselines.
//   --mode=attach Assume a server is already listening on PORT. No lifecycle.
//
// Other flags:
//   --port=3001         (default 3001)
//   --routes=a,b,c      (override the default route list)
//   --warmup            (do a throwaway request per route before measuring)
//   --runs=N            (run Lighthouse N times per route and report median; default 1)
//
// Run: `npm run lighthouse` or `node scripts/lighthouse-baseline.mjs`.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

// ----------------------------------------------------------------------------
// CLI arg parsing
// ----------------------------------------------------------------------------

const ARGV = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) return [arg, true];
    return [m[1], m[2] ?? true];
  }),
);

const MODE = String(ARGV.mode ?? 'prod');
const PORT = Number(ARGV.port ?? 3001);
const WARMUP = Boolean(ARGV.warmup);
const RUNS = Math.max(1, Number(ARGV.runs ?? 1));

// A real recent report filename (see artifacts/reports/). If this file is
// renamed/removed, the /report run will 404 — pick another from the directory.
const REPORT_FIXTURE = '188-n8n-2026-05-16.md';

const DEFAULT_ROUTES = [
  { name: 'home', path: '/' },
  { name: 'table', path: '/table' },
  { name: 'pipeline', path: '/pipeline' },
  { name: 'profile', path: '/profile' },
  { name: 'settings', path: '/settings' },
  { name: 'analytics', path: '/analytics' },
  { name: 'report', path: `/report/${encodeURIComponent(REPORT_FIXTURE)}` },
];

const ROUTES = ARGV.routes
  ? String(ARGV.routes)
      .split(',')
      .map(p => ({
        name: p.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'root',
        path: p,
      }))
  : DEFAULT_ROUTES;

const ARTIFACT_DIR = resolve(process.cwd(), 'artifacts/lighthouse');
const BASE_URL = `http://localhost:${PORT}`;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function log(msg) {
  console.log(`[lighthouse-baseline] ${msg}`);
}

async function isPortInUse(port) {
  return new Promise(resolveFn => {
    const tester = createServer()
      .once('error', err => resolveFn(err.code === 'EADDRINUSE'))
      .once('listening', () => tester.once('close', () => resolveFn(false)).close())
      .listen(port);
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await delay(500);
  }
  return false;
}

function spawnServer(command, args) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT) },
  });
  child.stdout?.on('data', d => {
    const s = d.toString().trim();
    if (s) log(`server: ${s.split('\n').slice(0, 2).join(' | ')}`);
  });
  child.stderr?.on('data', d => {
    const s = d.toString().trim();
    if (s) log(`server-err: ${s.split('\n').slice(0, 2).join(' | ')}`);
  });
  return child;
}

async function startServer() {
  const inUse = await isPortInUse(PORT);

  if (MODE === 'attach') {
    if (!inUse) throw new Error(`--mode=attach but nothing on port ${PORT}`);
    log(`Attached to existing server on :${PORT}`);
    return null;
  }

  if (inUse) {
    log(`Port ${PORT} already in use — attaching (skip spawn)`);
    return null;
  }

  if (MODE === 'prod') {
    if (!existsSync(resolve(process.cwd(), '.next/BUILD_ID'))) {
      log('No production build found — running `next build` first…');
      await new Promise((res, rej) => {
        const b = spawn('npx', ['next', 'build'], { stdio: 'inherit' });
        b.once('exit', code => (code === 0 ? res() : rej(new Error(`next build exit ${code}`))));
      });
    }
    log(`Starting next start -p ${PORT}…`);
    const child = spawnServer('npx', ['next', 'start', '-p', String(PORT)]);
    const ok = await waitForServer(BASE_URL);
    if (!ok) {
      child.kill('SIGTERM');
      throw new Error(`Server did not become ready at ${BASE_URL}`);
    }
    log(`Server ready (prod) on :${PORT}`);
    return child;
  }

  if (MODE === 'dev') {
    log(`Starting next dev -p ${PORT}…`);
    const child = spawnServer('npx', ['next', 'dev', '-p', String(PORT)]);
    const ok = await waitForServer(BASE_URL, 90_000);
    if (!ok) {
      child.kill('SIGTERM');
      throw new Error(`Dev server did not become ready at ${BASE_URL}`);
    }
    log(`Server ready (dev) on :${PORT}`);
    return child;
  }

  throw new Error(`Unknown --mode=${MODE}`);
}

function stopServer(child) {
  if (!child) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* noop */
  }
}

function pct(score) {
  return score == null ? null : Math.round(score * 100);
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function runLighthouseOnce(url, chromePort) {
  // Lighthouse config:
  //   - desktop preset (Sur9e is a desktop CRM, mobile preset will lie)
  //   - provided throttling (loopback has zero latency; simulated will be wrong)
  //   - skip PWA (no service worker / manifest)
  const flags = {
    port: chromePort,
    output: ['json', 'html'],
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
  };
  const config = {
    extends: 'lighthouse:default',
    settings: {
      formFactor: 'desktop',
      screenEmulation: {
        mobile: false,
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        disabled: false,
      },
      throttlingMethod: 'provided',
      emulatedUserAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Lighthouse',
    },
  };
  const result = await lighthouse(url, flags, config);
  if (!result) throw new Error(`Lighthouse returned no result for ${url}`);
  return result;
}

function extractSummary(lhr) {
  const c = lhr.categories;
  const a = lhr.audits;
  return {
    perf: pct(c.performance?.score),
    a11y: pct(c.accessibility?.score),
    best: pct(c['best-practices']?.score),
    seo: pct(c.seo?.score),
    lcp_ms: a['largest-contentful-paint']?.numericValue ?? null,
    fcp_ms: a['first-contentful-paint']?.numericValue ?? null,
    cls: a['cumulative-layout-shift']?.numericValue ?? null,
    tbt_ms: a['total-blocking-time']?.numericValue ?? null,
    si_ms: a['speed-index']?.numericValue ?? null,
    tti_ms: a['interactive']?.numericValue ?? null,
    transfer_bytes: a['total-byte-weight']?.numericValue ?? null,
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  log(`Mode: ${MODE} | Port: ${PORT} | Runs: ${RUNS} | Routes: ${ROUTES.length}`);
  const server = await startServer();

  // Warm-up: dev compiles on demand, even prod can JIT some chunks.
  if (WARMUP || MODE === 'dev') {
    log('Warming routes…');
    for (const r of ROUTES) {
      try {
        await fetch(`${BASE_URL}${r.path}`, { redirect: 'follow' });
      } catch {
        /* server may flake on first hit */
      }
    }
    await delay(1000);
  }

  const chrome = await launch({
    chromeFlags: ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  log(`Chrome launched on debug port ${chrome.port}`);

  const summary = {
    capturedAt: new Date().toISOString(),
    mode: MODE,
    port: PORT,
    runs: RUNS,
    baseUrl: BASE_URL,
    lighthouseVersion: null,
    chromeVersion: null,
    routes: [],
  };

  try {
    for (const route of ROUTES) {
      const url = `${BASE_URL}${route.path}`;
      log(`---- ${route.name} (${url}) ----`);

      const runs = [];
      let lastReport = null;
      for (let i = 0; i < RUNS; i++) {
        try {
          const result = await runLighthouseOnce(url, chrome.port);
          lastReport = result;
          const s = extractSummary(result.lhr);
          log(
            `  run ${i + 1}: perf=${s.perf} a11y=${s.a11y} best=${s.best} seo=${s.seo} ` +
              `LCP=${Math.round(s.lcp_ms ?? 0)}ms TBT=${Math.round(s.tbt_ms ?? 0)}ms`,
          );
          runs.push(s);
        } catch (err) {
          log(`  run ${i + 1} FAILED: ${err.message}`);
          runs.push(null);
        }
      }

      const successful = runs.filter(Boolean);
      const agg =
        successful.length === 0
          ? null
          : {
              perf: median(successful.map(r => r.perf).filter(x => x != null)),
              a11y: median(successful.map(r => r.a11y).filter(x => x != null)),
              best: median(successful.map(r => r.best).filter(x => x != null)),
              seo: median(successful.map(r => r.seo).filter(x => x != null)),
              lcp_ms: median(successful.map(r => r.lcp_ms).filter(x => x != null)),
              fcp_ms: median(successful.map(r => r.fcp_ms).filter(x => x != null)),
              cls: successful.length
                ? Number(
                    (
                      successful.map(r => r.cls ?? 0).reduce((a, b) => a + b, 0) / successful.length
                    ).toFixed(3),
                  )
                : null,
              tbt_ms: median(successful.map(r => r.tbt_ms).filter(x => x != null)),
              si_ms: median(successful.map(r => r.si_ms).filter(x => x != null)),
              tti_ms: median(successful.map(r => r.tti_ms).filter(x => x != null)),
              transfer_bytes: median(successful.map(r => r.transfer_bytes).filter(x => x != null)),
            };

      summary.routes.push({
        name: route.name,
        path: route.path,
        url,
        runs,
        summary: agg,
      });

      // Persist per-route artifacts from the last successful run.
      if (lastReport) {
        if (!summary.lighthouseVersion)
          summary.lighthouseVersion = lastReport.lhr.lighthouseVersion;
        if (!summary.chromeVersion)
          summary.chromeVersion = lastReport.lhr.environment?.hostUserAgent ?? null;
        const slug = route.name;
        writeFileSync(
          join(ARTIFACT_DIR, `${slug}.report.json`),
          JSON.stringify(lastReport.lhr, null, 2),
        );
        const html = Array.isArray(lastReport.report) ? lastReport.report[1] : lastReport.report;
        if (typeof html === 'string') {
          writeFileSync(join(ARTIFACT_DIR, `${slug}.report.html`), html);
        }
      }
    }

    writeFileSync(join(ARTIFACT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
    log(`Summary written: ${join(ARTIFACT_DIR, 'summary.json')}`);

    // Pretty-print a markdown table to stdout so the human can paste it.
    console.log('\n## Per-route scores (median across runs)\n');
    console.log('| Route | Perf | A11y | Best | SEO | LCP (ms) | CLS | TBT (ms) | Transfer (KB) |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of summary.routes) {
      const s = r.summary;
      if (!s) {
        console.log(`| ${r.path} | — | — | — | — | — | — | — | — |`);
        continue;
      }
      const kb = s.transfer_bytes != null ? Math.round(s.transfer_bytes / 1024) : '—';
      console.log(
        `| ${r.path} | ${s.perf ?? '—'} | ${s.a11y ?? '—'} | ${s.best ?? '—'} | ${s.seo ?? '—'} | ` +
          `${s.lcp_ms != null ? Math.round(s.lcp_ms) : '—'} | ${s.cls ?? '—'} | ` +
          `${s.tbt_ms != null ? Math.round(s.tbt_ms) : '—'} | ${kb} |`,
      );
    }
  } finally {
    await chrome.kill();
    stopServer(server);
    // Give children a moment to release the port.
    await delay(500);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
