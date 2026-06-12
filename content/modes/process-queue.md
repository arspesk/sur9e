---
exec: interactive
needs_tools: [shell, file_read, file_write]
---

# Mode: process-queue -- drain the URL inbox

> Formerly `pipeline`. The old name still routes here.

Processes the job-offer URLs sitting in `data/pipeline.md` — the same inbox the
web UI's pipeline page reads and its **Screen pending** button drains. The
default action is to **screen every pending offer cheaply**; full evaluation is
opt-in afterward, on the offers worth it.

This is screen-first by design: screening is cheap and fast, so the queue gets a
0-5 score and a mini-report for every URL before you spend a deep evaluation on
anything. Quality over quantity — the screen is the filter, not a shortcut.

## Step 1 -- Count pending URLs

Read `data/pipeline.md` and count lines matching `^- \[ \]` inside the
`## Pending` section.

- **0 pending** → tell the user "Nothing pending. Add URLs to `data/pipeline.md`
  (or use the web UI's pipeline page)."
- **1+ pending** → continue to Step 2.

## Step 2 -- Screen every pending offer (default)

Run the worker screener over the whole queue:

```bash
node batch/screen.mjs --parallel 5
```

The screener reads `## Pending` from `data/pipeline.md` itself, fetches each JD,
runs the headless screening model (the `screen` mode's configured
provider/model — see Settings → Models), writes a mini-report to
`artifacts/reports/` and a Screened/Discarded tracker row per offer, and flips
each `- [ ]` line to `- [x]` as it finishes (so re-running only picks up new
URLs). No model is hardcoded — it uses whatever you've set for screening.

When it's done, the screener prints a summary (total / completed / failed,
score distribution, archetype breakdown). Forward that to the user.

To screen a single pending URL instead of the whole queue:

```bash
node batch/screen.mjs --url <url>
```

## Step 3 -- Offer the deep pass (opt-in)

Screening only decides what's worth a full evaluation — it never replaces it.
After the summary, surface the strong scorers and ask whether to evaluate them:

- **A few offers** → run `/sur9e evaluate-offer <url>` (or the in-app
  Re-evaluate action) per offer for a full A-F evaluation + report.
- **A large survivor set** → hand off to `/sur9e batch-evaluate`, which runs the
  full evaluator only on the offers screening flagged `EVALUATE`.

PDFs stay on-demand — generate them with `/sur9e tailor-cv {report_num}` when an
application is actually going out, not for every screened offer.

## Step 4 -- Summary

Show the user:

- Screening stats (screened / discarded, score distribution, top scorers)
- The pending count remaining (should be 0 after a full drain)
- Next-step hints: `/sur9e tracker`, `/sur9e evaluate-offer <url>`, or
  `/sur9e batch-evaluate` for the survivors

## pipeline.md format

`data/pipeline.md` is the queue file (the UI's pipeline page edits the same
file). The screener only reads and updates it — you generally don't hand-edit it
except to add URLs under `## Pending`.

```markdown
## Pending

- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [!] https://private.url/job — Error: login required

## Processed

- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI SE | 4.2/5 | PDF ❌
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

Add a URL to the queue without opening the file by hand:

```bash
node batch/add-to-pipeline.mjs <url> [company]
```

It's idempotent (skips a URL that's already screened) and appends under
`## Pending`.

## Special cases

- **LinkedIn / login-walled posts**: the screener may not reach the JD and will
  mark the line `- [!]` with a note. Ask the user to paste the JD text and run
  `/sur9e evaluate-offer` on it directly.
- **`local:` prefix**: a `local:jds/foo.md` entry points at
  `inputs/jds/foo.md` — a JD you saved locally.

## Source synchronization

If a screening run reports a CV/profile desync, warn the user before continuing:

```bash
node cv-sync-check.mjs
```
