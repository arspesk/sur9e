#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Example local parser for sur9e's universal scanner (Wave E).
//
// WHAT THIS IS: a tiny script that fetches a company's careers page (or its
// hidden JSON endpoint), extracts the open roles, and prints them as JSON to
// stdout. The scanner runs it for any company whose `parser:` block points
// here, then applies the same title sieve + location filter + dedup as the
// built-in ATS providers.
//
// HOW TO USE IT:
//   1. Copy this file to inputs/parsers/<company>.mjs (that dir is the only
//      place the scanner will run a script from).
//   2. Point a tracked_companies entry at it in portals.yml:
//        - name: Acme
//          careers_url: https://acme.example.com/careers
//          parser:
//            command: node
//            script: inputs/parsers/acme.mjs
//            args: ["--url", "{careers_url}"]
//   3. Fill in fetchJobs() below for the actual page. The fastest path is to
//      open the careers page's Network tab and find the XHR that returns the
//      job list as JSON — most bespoke sites have one.
//
// Or just ask your agent: "write a sur9e parser for <company>'s careers page" —
// it can inspect the page and fill this in for you.
//
// OUTPUT CONTRACT: print JSON to stdout, either a bare array or { jobs: [...] }.
// Each job: { title, url, location? }. `url` may be relative — the scanner
// resolves it against careers_url. Rows missing title or url are dropped.

// Read the --url flag the `args` substitution passes in ({careers_url}).
function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function fetchJobs(careersUrl) {
  // ── Replace this block with the real extraction. ──────────────────────────
  // Common pattern — a JSON endpoint behind the careers page:
  //
  //   const res = await fetch('https://acme.example.com/api/jobs');
  //   const data = await res.json();
  //   return data.positions.map(p => ({
  //     title: p.name,
  //     url: p.absolute_url,         // relative is fine
  //     location: p.location?.name,
  //   }));
  //
  // For static HTML, fetch the page and parse it (e.g. with a regex over the
  // job-link anchors, or a DOM library you add to inputs/parsers/).
  void careersUrl;
  return [];
}

async function main() {
  const careersUrl = getArg('--url') || '';
  try {
    const jobs = await fetchJobs(careersUrl);
    process.stdout.write(JSON.stringify({ jobs }));
  } catch (err) {
    // Non-zero exit + a stderr message → the scanner reports this company as a
    // per-company error and keeps scanning the rest.
    process.stderr.write(`parser failed: ${err?.message ?? err}\n`);
    process.exit(1);
  }
}

main();
