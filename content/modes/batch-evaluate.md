---
exec: headless
needs_tools: [shell, file_read, file_write, web_search]
---

# Mode: batch-evaluate — Bulk Offer Processing (two-stage)

Cost-optimized bulk evaluator. Runs a cheap first-pass screen on every offer, then the full evaluator only on survivors. The screening and evaluation models are whatever you've set for the `screen` and `evaluate` modes in Settings → Models (any provider — claude, codex, or opencode); pairing a cheap screener with a deeper evaluator is what keeps bulk runs affordable.

## The flow

```
data/pipeline.md
      │
      ▼  node batch/pipeline-to-input.mjs
batch/batch-input.tsv  (id, url, title, company)
      │
      ▼  node batch/screen.mjs --parallel 5
batch/screen-results.tsv  (score, verdict EVALUATE|SKIP, archetype, reason)
      │
      ▼  ./batch/batch-runner.sh --respect-screening --parallel 4
artifacts/reports/*.md + batch/tracker-additions/*.tsv   (only EVALUATE offers)
      │
      ▼  auto-merge at end of batch-runner.sh
data/applications.md  (dashboard reads this)
```

PDFs are **not** generated during the batch. Use `/sur9e pdf {report_num}` on demand.

## Default workflow when user invokes `/sur9e batch`

Run these steps in order. After each step, show the user the output and proceed unless there's a reason to stop.

### Step 1 — Sync inbox into batch input

```bash
node batch/pipeline-to-input.mjs
```

Confirms how many rows were added to `batch/batch-input.tsv`.

### Step 2 — Screening

```bash
node batch/screen.mjs --parallel 5
```

The screener processes every pending row in `batch-input.tsv` with the screening model (the `screen` mode's configured provider/model), writes to `screen-results.tsv`, and prints a summary:

- Total / Completed / Failed
- EVALUATE count (the survivors for Evaluation)
- SKIP count
- Score distribution
- Archetype distribution

Show the summary to the user. If the EVALUATE count is unexpectedly large (> 150) or small (< 5), ask before proceeding.

### Step 3 — Evaluation: full evaluator (on EVALUATE only)

```bash
./batch/batch-runner.sh --respect-screening --parallel 4
```

Emit report header fields per `_shared.md` → "Header field shapes".

Evaluation runs the `evaluate`-mode provider's workers (full evaluation) only on offers where `screen-results.tsv` verdict is `EVALUATE`. Each worker produces:

- `artifacts/reports/NNN-{company-slug}-{date}.md` (full evaluation report, **no PDF**)
- `batch/tracker-additions/NNN-{slug}.tsv` (one-line tracker row)

At the end, `batch-runner.sh` auto-merges tracker additions into `data/applications.md` and runs `verify-pipeline.mjs`.

### Step 4 — Summary to user

Show:

- Screening stats
- Evaluation stats (reports written, average score, top 5 by score)
- Total cost (scales with `screening_total` on the cheap screening model + `evaluation_total` on the deeper evaluation model; exact per-token rates depend on the providers you've configured)
- Next steps:
  - `/sur9e tracker` to see the table
  - `/sur9e pdf {report_num}` to generate a PDF for a specific offer
  - Open the dashboard: `cd dashboard && ./sur9e-dashboard --path ..`

---

## Alternative modes

### `--generate-pdfs` (not recommended for bulk)

If the user explicitly asks for PDFs during the batch, add the flag:

```bash
./batch/batch-runner.sh --respect-stage1 --parallel 4 --generate-pdfs
```

Warn the user: this slows down each worker significantly (Playwright launches per offer) and 90% of the PDFs won't be applied with anyway.

### Chrome-conductor mode (legacy, rarely used)

If the user invokes with `--chrome`, use the legacy conductor flow: drive Chrome through logged-in portals, scrape JDs from the DOM, and feed URLs into `batch/batch-input.tsv` as you go. Only useful for portals the scanner can't hit (LinkedIn with paywall, Workday without a public API, etc.).

```
Claude Conductor (claude --chrome --dangerously-skip-permissions)
  │
  ├─ Offer 1: Chrome reads JD from DOM
  │    └─► claude -p worker → report + tracker
  │
  └─ End: merge tracker-additions → applications.md
```

---

## Files

```
batch/
  pipeline-to-input.mjs        # Sync data/pipeline.md → batch-input.tsv
  screen-prompt.md             # screening system prompt
  screen.mjs                   # Screening orchestrator
  screen-results.tsv           # Screening output
  batch-input.tsv              # Input for Evaluation (shared)
  batch-prompt.md              # evaluation system prompt
  batch-runner.sh              # Evaluation orchestrator
  batch-state.tsv              # Evaluation state (auto-managed, resumable)
  logs/                        # Evaluation per-offer logs
  logs/screening/              # Screening per-offer logs
  tracker-additions/           # TSV lines produced by workers
    merged/                    # Post-merge archive
```

## Options (batch-runner.sh)

| Flag                      | Default | Purpose                                                     |
| ------------------------- | ------- | ----------------------------------------------------------- |
| `--parallel N`            | 1       | Concurrent evaluation workers                               |
| `--dry-run`               | off     | Preview what would run                                      |
| `--respect-screening`     | off     | Skip offers where screening verdict ≠ EVALUATE              |
| `--screening-min-score N` | 3       | Screening score threshold when `--respect-screening` is set |
| `--generate-pdfs`         | off     | Generate PDFs inline (expensive; normally off)              |
| `--retry-failed`          | off     | Retry only offers marked `failed` in state                  |
| `--start-from N`          | 0       | Resume from offer ID N                                      |
| `--max-retries N`         | 2       | Max retries per offer                                       |

## Resumability

- `batch-state.tsv` tracks Evaluation per-offer status. Re-running `batch-runner.sh` skips completed rows.
- `screen-results.tsv` is append-only. Re-running `screen.mjs` without `--retry-failed` skips completed rows.
- A PID-based lock file (`batch-runner.pid`) prevents concurrent Evaluation runs.

## Prerequisites

- Your `evaluate`-mode provider's CLI in PATH and authenticated (claude, codex, or opencode — whichever you've configured in Settings → Models)
- Node.js ≥ 18
- `batch/batch-input.tsv` populated (Step 1 above handles this automatically)
