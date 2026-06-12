---
name: sur9e
description: AI job search command center -- evaluate offers, generate CVs, scan portals, track applications
user-invocable: true
arguments: mode
argument-hint: "[JD/URL|scan|screen|evaluate|apply|tracker|…]"
---

# sur9e -- Router

## Mode Routing

Determine the mode from `{{mode}}`:

| Input                                  | Mode                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (empty / no args)                      | `discovery` -- Show command menu                                                                                                                               |
| JD text or URL (no sub-command)        | **`evaluate-offer`**                                                                                                                                           |
| `evaluate`                             | `evaluate`                                                                                                                                                     |
| `screen <url>`                         | `screen` (worker-run quick screen)                                                                                                                             |
| `evaluate-offer`                       | `evaluate-offer`                                                                                                                                               |
| `auto-pipeline`                        | `evaluate-offer` (legacy alias)                                                                                                                                |
| `offer`                                | `evaluate` (legacy alias)                                                                                                                                      |
| `offers`                               | `offers`                                                                                                                                                       |
| `reach-out`                            | `reach-out`                                                                                                                                                    |
| `contact`                              | `reach-out` (legacy alias)                                                                                                                                     |
| `research`                             | `research`                                                                                                                                                     |
| `deep`                                 | `research` (legacy alias)                                                                                                                                      |
| `tailor-cv`                            | `tailor-cv`                                                                                                                                                    |
| `pdf`                                  | `tailor-cv` (legacy alias)                                                                                                                                     |
| `training`                             | `training`                                                                                                                                                     |
| `project`                              | `project`                                                                                                                                                      |
| `tracker`                              | `tracker`                                                                                                                                                      |
| `process-queue`                        | `process-queue`                                                                                                                                                |
| `pipeline`                             | `process-queue` (legacy alias)                                                                                                                                 |
| `apply [num] [--chrome\|--playwright]` | `apply` (flags pick the browser; see mode file)                                                                                                                |
| `scan`                                 | Run `npm run scan` (ATS portals + JobSpy → screen → tracker) and report new offers. If the dev server is up, POST `/api/jobs/scan` so the loading modal shows. |
| `scan schedule …`                      | Point the user to Settings → Job scanning (the scan cron lives in the UI).                                                                                     |
| `batch-evaluate`                       | `batch-evaluate`                                                                                                                                               |
| `batch`                                | `batch-evaluate` (legacy alias)                                                                                                                                |
| `patterns`                             | `patterns`                                                                                                                                                     |
| `follow-up`                            | `follow-up`                                                                                                                                                    |
| `followup`                             | `follow-up` (legacy alias)                                                                                                                                     |
| `interview-prep`                       | `interview-prep`                                                                                                                                               |
| `interview`                            | `interview-prep` (legacy alias)                                                                                                                                |
| `enrich`                               | `enrich`                                                                                                                                                       |
| `latex`                                | `latex`                                                                                                                                                        |

**Legacy aliases:** `auto-pipeline`/`pipeline` are the pre-rename names for
`evaluate-offer`/`process-queue`; `offer`/`deep`/`contact`/`pdf`/`followup` are
older pre-unification names. They all still route to their renamed modes so
older muscle-memory and saved commands keep working. Prefer the canonical names
going forward.

**Auto-detection:** If `{{mode}}` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `evaluate-offer`.

If `{{mode}}` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Discovery Mode (no arguments)

Show this menu:

```
sur9e -- Command Center

Available commands:
  /sur9e {JD}      → EVALUATE-OFFER: evaluate + report + PDF + tracker (paste text or URL)
  /sur9e screen {URL} → Quick screen only: cheap mini-report + 0-5 score (no full eval)
  /sur9e process-queue → Screen every pending URL in the inbox (data/pipeline.md)
  /sur9e evaluate  → Evaluation only A-F (no auto PDF)
  /sur9e offers    → Compare and rank multiple offers
  /sur9e reach-out → LinkedIn power move: find contacts + draft message
  /sur9e research  → Deep research prompt about company
  /sur9e tailor-cv → PDF only, ATS-optimized CV
  /sur9e enrich    → Interview to strengthen your CV: mine roles for metrics + hidden skills
  /sur9e training  → Evaluate course/cert against North Star
  /sur9e project   → Evaluate portfolio project idea
  /sur9e tracker   → Application status overview
  /sur9e apply [num] [--chrome|--playwright] → Live application assistant. Offer num skips discovery; flag forces the browser (default: your browser via the CLI extension is primary, Playwright only as fallback for blocked domains/unreachable forms)
  /sur9e scan               → Crawl portals + screen each new offer (runs `npm run scan`); schedule lives in Settings → Job scanning
  /sur9e batch-evaluate → Full evaluation on the URLs that scored well during scan
  /sur9e patterns  → Analyze rejection patterns and improve targeting
  /sur9e follow-up → Follow-up cadence tracker: flag overdue, generate drafts
  /sur9e interview-prep → Company-specific interview intel: process, likely questions, story-bank mapping
  /sur9e latex     → LaTeX/Overleaf CV export (.tex + pdflatex-compiled PDF)

Inbox: add URLs to data/pipeline.md → /sur9e process-queue
Or paste a JD directly to run the full evaluation.
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

### Modes that require `_shared.md` + their mode file:

Read `content/modes/_shared.md` + `content/modes/{mode}.md`

Applies to: `evaluate-offer`, `evaluate`, `offers`, `tailor-cv`, `latex`, `reach-out`, `apply`, `process-queue`, `batch-evaluate`

### Standalone modes (only their mode file):

Read `content/modes/{mode}.md`

Applies to: `tracker`, `research`, `training`, `project`, `patterns`, `follow-up`, `interview-prep`

### Script-run mode: `screen`

`content/modes/screen.md` is **worker-executed** (spawned headless by `batch/screen.mjs`) — do NOT load it as agent context. To screen a single URL:

1. `node batch/add-to-pipeline.mjs <url> [company]` — add it to the `data/pipeline.md` pendings (idempotent; skips if already screened)
2. `node batch/screen.mjs --url <url>` — fetches the JD, runs the headless screener, writes the mini-report to `artifacts/reports/` and the tracker row
3. Read the generated report and present the score, headline, and next_steps to the user

Screening needs a **URL** (the worker fetches the JD itself). If the user pasted raw JD text, offer the full evaluate-offer instead or ask for the posting URL.

### Modes delegated to subagent:

For `process-queue` (3+ URLs): launch as Agent with the content of `_shared.md` + `content/modes/{mode}.md` injected into the subagent prompt. (`scan` is not a mode — it runs `npm run scan`.)

`apply` runs in the **main conversation**, not a subagent: it needs the user in the loop per form (browser choice, uploads where automation can't reach, EEO confirmations, and the final Submit which is always the user's click). The CLI browser-extension tool is always primary; Playwright is the fallback per the "Browser selection" rules in `content/modes/apply.md` (`--chrome`/`--playwright` flags force it).

```
Agent(
  subagent_type="general-purpose",
  prompt="[content of content/modes/_shared.md]\n\n[content of content/modes/{mode}.md]\n\n[invocation-specific data]",
  description="sur9e {mode}"
)
```

Execute the instructions from the loaded mode file. (`{mode}` is the canonical
routed mode — legacy aliases resolve to it before this step, so the file path is
always the renamed file, e.g. `content/modes/research.md`.)
