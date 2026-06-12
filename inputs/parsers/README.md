# inputs/parsers/

Local **parser scripts** for the universal scanner live here — the escape hatch
for companies whose careers page isn't one of the built-in ATS (Greenhouse,
Ashby, Lever, Workable, Workday, Recruitee, SmartRecruiters, SolidJobs).

A script fetches a company's open roles and prints them as JSON to stdout; the
scanner (`batch/scan-portals.mjs`) runs it and pipes the result through the same
title sieve, location filter, and dedup as the built-in providers.

## Add one

1. Copy the template:
   `cp content/examples/parsers/example.mjs inputs/parsers/<company>.mjs`
2. Fill in its `fetchJobs()` to return `[{ title, url, location? }]`. Or ask your
   agent: **"write a sur9e parser for &lt;company&gt;'s careers page."**
3. Point a `tracked_companies` entry at it in
   `inputs/personalization/portals.yml`:
   ```yaml
   - name: Acme
     careers_url: https://acme.example.com/careers
     parser:
       command: node
       script: inputs/parsers/acme.mjs
       args: ["--url", "{careers_url}"]
     enabled: true
   ```

Full guide: [`docs/customization.md`](../../docs/customization.md) →
"Custom parsers".

## Rules

- **This folder is the only place** the scanner will run a script from.
- `command` must be an allowlisted interpreter:
  `python3` / `python` / `node` / `deno` / `bash` / `sh` / `ruby`.
- Each run has no shell, a 20s timeout, and a 2 MB output cap.
- **Your scripts here are gitignored** — only this README is tracked, so the
  feature stays discoverable without shipping anyone's private parsers.
