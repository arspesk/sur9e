# Data contract — User layer vs System layer

The repo distinguishes between data **the user owns** and data **the system maintains**. This rule prevents `update-system.mjs` from clobbering user customizations on auto-updates.

**The rule:**

- No User Layer path may be replaced from upstream, staged, or uploaded. User
  content and work product must never be modified or deleted by the updater.
- One narrow local read is intentional: `update-system.mjs` reads
  `inputs/config/config.yml` to resolve only `system.update_source` and
  `system.update_branch`. The updater does not transmit that file or use its
  other settings.
- Two updater-owned control files are intentionally mutable:
  `.update-lock` is created and removed around an update, and
  `.update-dismissed` is written or cleared when the user dismisses or accepts
  an update. They remain protected from upstream replacement, staging, and
  upload.
- A file is replaceable from upstream only when the executable policy
  explicitly classifies it as System Layer.

## Bucket layout

The repo root has four sur9e-domain buckets, sorted by lifecycle:

- **`content/`** — committed product content (modes, templates, examples). Ships with the repo. System Layer.
- **`inputs/`** — user-authored, gitignored (personalization, config, jds). Each user fills these in. User Layer.
- **`artifacts/`** — generated artifacts (per-offer reports + CV/cover-letter PDFs in `output/`, plus the shared `interview-prep/story-bank.md`). Research, interview-prep, outreach, and negotiation analyses live inside the report body, not as separate files. Output of background jobs. User Layer (the user's work product, even though sur9e wrote it).
- **`data/`** — runtime state (applications.md, usage.json, pipeline.md, jobs/).
  Mutable databases. All of it is updater-protected, including recreateable
  scheduler and web-launcher state.

`batch/` contains the Python+shell scan/screen subsystem. Only entries included
in `SYSTEM_PATHS` are updateable; its logs, legacy JobSpy environment, tracker
additions, PID locks, and state/result files are User Layer.

The User/System split below uses paths from these buckets.

## Machine-enforced path boundary

This document explains the contract.
[`src/lib/repo-path-policy.mjs`](../src/lib/repo-path-policy.mjs) is the
canonical executable classification shared by the updater and CI:

- `USER_PATH_PREFIXES` protects all current and future paths under `inputs/`,
  `data/`, and `artifacts/`; batch logs, the legacy in-tree JobSpy environment,
  and tracker additions; plus `.claude/memory/`, `.claude/worktrees/`,
  local `.claude/skills/`, `.antigravitycli/`, `.playwright-mcp/`, `.serena/`,
  `.trash/`, `test-results/`, and `tmp/`.
- `USER_PATH_PATTERNS` protects generated names such as `.resolved-prompt-*`,
  root `batch/*.pid`, `text_*.json`, and YAML backups ending in `.yml.bak` or
  `.yaml.bak`, including backups nested under otherwise system-owned paths.
- `USER_PATH_FILES` protects exact local files such as `.env`, updater locks and
  dismissal state, `.claude/scheduled_tasks.lock`, local formatter/agent
  settings, and batch state/result files.
- `USER_PATH_EXCEPTIONS` keeps only the project-owned
  `.claude/skills/sur9e/` outside the local-skill boundary.
- `TRACKED_SCAFFOLDING` is the only exception. It enumerates the `.gitkeep` and
  README files that may remain tracked inside protected directories.
- `SYSTEM_PATHS` is the explicit upstream-update allowlist. All of `content/`
  is system-owned, including examples and future content paths.

`npm run test:quick` rejects any protected path already tracked by Git.
[`.github/workflows/user-data-boundary.yml`](../.github/workflows/user-data-boundary.yml)
runs [`src/lib/check-user-data-boundary.mjs`](../src/lib/check-user-data-boundary.mjs)
on pull-request diffs, including both sides of copies and renames. A boundary
change must update this document, the executable policy, and its tests in the
same PR.

## User Layer (NEVER auto-updated)

These paths contain personal data, customizations, work product, or local
runtime state. The updater never modifies or deletes user content or work
product; only its two control-state files described above are mutable.

| File/category                         | Purpose                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `inputs/*`                            | All personalization, configuration, saved JDs, parsers, and future user inputs                                                    |
| `data/*`                              | Tracker, pipeline, usage, jobs, launcher state, and all future runtime data                                                       |
| `artifacts/*`                         | Reports, PDFs, interview prep, Lighthouse output, and all future generated work product                                           |
| `batch/logs/*`                        | Local worker logs                                                                                                                 |
| `batch/jobspy-env/*`                  | Legacy in-tree JobSpy Python environment                                                                                          |
| `batch/tracker-additions/*`           | Pending tracker writes                                                                                                            |
| Batch state/results and `batch/*.pid` | Local scan, screen, evaluation, and process-lock state                                                                            |
| Generated files at any depth          | `.resolved-prompt-*` and `text_*.json`                                                                                            |
| Local tool, test, and scratch state   | `.env`, updater/agent locks and settings, custom Claude skills, agent/browser/worktree caches, `tmp/`, trash, and `test-results/` |
| YAML backup files                     | `*.yml.bak` and `*.yaml.bak` at any repository depth                                                                              |

The scaffolding enumerated by `TRACKED_SCAFFOLDING` remains the only exception
inside these broad buckets. Unknown future paths under `inputs/`, `data/`, or
`artifacts/` are protected by default.

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that
improve with each release. This table is illustrative; `SYSTEM_PATHS` in the
executable policy is the exact allowlist.

| File                               | Purpose                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `content/*`                        | All tracked modes, templates, examples, and future product content         |
| `CLAUDE.md`                        | Agent instructions                                                         |
| `AGENTS.md`                        | Agent instructions for non-Claude runtimes                                 |
| `update-system.mjs`                | Update, rollback, and update-check logic                                   |
| `test-all.mjs`                     | Local and CI quick gate                                                    |
| `scripts/sync-release-version.mjs` | Release version synchronizer                                               |
| `scripts/update-worker.mjs`        | Detached update, restart, verification, and recovery worker                |
| `scripts/web.mjs`                  | Managed local, production, and Tailscale web launcher                      |
| `batch/batch-prompt.md`            | Batch worker prompt                                                        |
| `batch/batch-runner.sh`            | Batch orchestrator                                                         |
| `.claude/skills/sur9e/*`           | Project-owned sur9e skill                                                  |
| `docs/*`                           | Documentation                                                              |
| `VERSION`                          | Current version number                                                     |
| Release Please metadata            | Package metadata, lockfile, manifest, changelog, and release configuration |
| `.github/*`                        | Repository automation and policy                                           |

## Config keys — `scanning.schedule.*`

These keys live in `inputs/config/config.yml` (User Layer) under the
`scanning.schedule` group and are managed via Settings → Scheduled scans or
`/sur9e scan schedule`.

| Key                                | Type    | Default       | Purpose                                                                                                |
| ---------------------------------- | ------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `scanning.schedule.enabled`        | boolean | `false`       | Master switch; scheduler only fires when `true`                                                        |
| `scanning.schedule.cron`           | string  | `"0 9 * * *"` | Standard 5-field cron expression; validated at load time — invalid expressions are treated as disabled |
| `scanning.schedule.catch_up_hours` | number  | `24`          | Grace window (hours) for missed runs on server restart; `0` = never catch up                           |

## THE RULE

When the user asks to customize anything (archetypes, narrative, negotiation scripts, proof points, location policy, comp targets), write to `inputs/personalization/narrative.md` or `inputs/personalization/profile.yml`. **NEVER edit `content/modes/_shared.md` for user-specific content** — it gets overwritten on every system update.

## Tracker writes (TSV format)

When evaluations write to the tracker, they output one TSV file per evaluation to `batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns plus an optional 10th:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](artifacts/reports/{num}-{slug}-{date}.md)\t{note}\t{posted}
```

**Column order in the TSV:**

1. `num` — sequential 3-digit zero-padded
2. `date` — `YYYY-MM-DD` (the date the offer enters the tracker)
3. `company` — short company name
4. `role` — job title
5. `status` — canonical status (see below)
6. `score` — `X.X/5` (e.g. `4.2/5`)
7. `pdf` — `✅` or `❌`
8. `report` — markdown link `[num](artifacts/reports/{num}-{slug}-{date}.md)`
9. `notes` — one-line summary
10. `posted` — OPTIONAL true posting date, `YYYY-MM-DD`; empty/absent when the source reported none

**Note:** in `data/applications.md`, score appears BEFORE status. The merge script handles the column swap automatically.

## Posting date (`posted`) — optional field

`date` always means "when this offer entered the tracker" (scan/evaluation date) and stays required — sorting defaults, follow-up cadence, and analytics all key on it, unchanged. `posted` is the true posting date, carried separately:

- **Shape:** `YYYY-MM-DD`. Absent/unknown means the field is omitted entirely — never an empty string, never a guessed date. No backfill of existing rows.
- **Where it lives:** report frontmatter (`posted:` key), the tracker (`Posted`, an optional trailing 10th column in `data/applications.md`; legacy 9-column rows simply lack it), the tracker-addition TSVs (10th column), and `data/scan-history.tsv` (8th column).
- **Capture sources** (parse-and-keep from responses the scanners already fetch — zero extra network calls):

| Source        | Field                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------- |
| Greenhouse    | `first_published` (fallback `updated_at`)                                                           |
| Ashby         | `publishedAt`                                                                                       |
| Lever         | `createdAt` (epoch milliseconds)                                                                    |
| Workable      | `published_on` (fallback `created_at`)                                                              |
| Workday       | `postedOn` relative text ("Posted 3 Days Ago"), resolved against scan date — unparseable forms omit |
| JobSpy        | `date_posted` CSV column                                                                            |
| evaluate mode | the agent's `posted:` frontmatter field (the JD's stated posting date)                              |

After a batch of evaluations, run `node merge-tracker.mjs` to merge additions into `data/applications.md`.

## Pipeline integrity

1. **NEVER edit `data/applications.md` to ADD new entries.** Write a TSV in `batch/tracker-additions/` and let `merge-tracker.mjs` merge.
2. **YES you may edit `data/applications.md` to UPDATE status/notes of existing entries.** (The `dedup-tracker.mjs` script will warn on duplicates if you accidentally double-add.)
3. URL-backed reports MUST preserve the real posting URL. Reports created from pasted text instead preserve `source_kind: text`, `jd_path`, and `jd_hash` in frontmatter and MUST NOT invent a URL. Reports generated under the v1.3+ rubric MUST also include `**Legitimacy:** {tier}`. Legacy reports written before posting-legitimacy assessment existed are exempt — do not backfill (the absence accurately reflects "not assessed").
4. All status values MUST be canonical (see below). No bold, no dates, no extra text.

## Health checks

```bash
node verify-pipeline.mjs    # finds inconsistencies between tracker and reports
node normalize-statuses.mjs # canonicalizes the status field
node dedup-tracker.mjs      # removes duplicate entries
```

Run after any manual edit to `data/applications.md` or after batch processing.

## Canonical statuses

Source of truth: `content/templates/states.yml`.

| State       | When to use                                  |
| ----------- | -------------------------------------------- |
| `Screened`  | Limited report completed, pending evaluation |
| `Evaluated` | Report completed, pending decision           |
| `Applied`   | Application sent                             |
| `Responded` | Company responded                            |
| `Interview` | In interview process                         |
| `Offer`     | Offer received                               |
| `Rejected`  | Rejected by company                          |
| `Discarded` | Discarded by candidate or offer closed       |

> `SKIP` was retired as a canonical status (merged into `Discarded`). It
> survives only as a legacy alias: every validator silently rewrites
> `SKIP` → `Discarded`. Do not write it into new tracker rows.

**Rules for the status field:**

- No markdown bold (`**Applied**` is wrong; `Applied` is right)
- No dates in status field — use the date column
- No extra text — use the notes column
- Status field is the literal canonical name from the table above
