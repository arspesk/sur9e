# Data contract — User layer vs System layer

The repo distinguishes between data **the user owns** and data **the system maintains**. This rule prevents `update-system.mjs` from clobbering user customizations on auto-updates.

**The rule:**

- If a file is in the User Layer, **no update process may read, modify, or delete it.**
- If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.

## Bucket layout

The repo root has four sur9e-domain buckets, sorted by lifecycle:

- **`content/`** — committed product content (modes, templates, examples). Ships with the repo. System Layer.
- **`inputs/`** — user-authored, gitignored (personalization, config, jds). Each user fills these in. User Layer.
- **`artifacts/`** — generated per-offer (reports, output, outreach, interview-prep). Output of background jobs. User Layer (the user's work product, even though sur9e wrote it).
- **`data/`** — runtime state (applications.md, usage.json, pipeline.md, jobs/). Mutable databases. Stays at root. Mixed: tracker is User Layer; transient logs are System Layer.

`batch/` (Python+shell scan/screen subsystem) is code, not data — also at root, System Layer.

The User/System split below uses paths from these buckets.

## User Layer (NEVER auto-updated)

These files contain personal data, customizations, and work product. Updates will NEVER modify them.

| File                                       | Purpose                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `inputs/personalization/cv.md`             | Your CV in markdown                                                        |
| `inputs/personalization/profile.yml`       | Your identity, targets, comp range                                         |
| `inputs/personalization/narrative.md`      | Per-archetype framing, cross-cutting advantage, negotiation scripts, voice |
| `inputs/personalization/article-digest.md` | Your proof points from portfolio                                           |
| `inputs/personalization/portals.yml`       | ATS portal scanner company list (`tracked_companies`); optional            |
| `inputs/config/config.yml`                 | Tool settings (API keys, preferences, schedule config)                     |
| `artifacts/interview-prep/story-bank.md`   | Your accumulated STAR+R stories                                            |
| `data/applications.md`                     | Your application tracker                                                   |
| `data/pipeline.md`                         | Your URL inbox                                                             |
| `data/scan-history.tsv`                    | Your scan history                                                          |
| `data/follow-ups.md`                       | Your follow-up history                                                     |
| `artifacts/reports/*`                      | Your evaluation reports                                                    |
| `artifacts/output/*`                       | Your generated PDFs                                                        |
| `inputs/jds/*`                             | Your saved job descriptions                                                |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File                              | Purpose                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `content/modes/_shared.md`        | Scoring system, global rules, tools                                                                                                   |
| `content/modes/evaluate.md`       | Evaluation mode instructions                                                                                                          |
| `content/modes/tailor-cv.md`      | CV tailoring instructions                                                                                                             |
| `content/modes/batch-evaluate.md` | Bulk two-stage (screen → evaluate) processing instructions                                                                            |
| `content/modes/apply.md`          | Application assistant instructions                                                                                                    |
| `content/modes/evaluate-offer.md` | Full-pipeline (evaluate + report + tracker) instructions                                                                              |
| `content/modes/reach-out.md`      | LinkedIn outreach instructions                                                                                                        |
| `content/modes/research.md`       | Research prompt instructions                                                                                                          |
| `content/modes/offers.md`         | Comparison instructions                                                                                                               |
| `content/modes/process-queue.md`  | URL-inbox queue-draining (screen-all) instructions                                                                                    |
| `content/modes/project.md`        | Project evaluation instructions                                                                                                       |
| `content/modes/tracker.md`        | Tracker instructions                                                                                                                  |
| `content/modes/training.md`       | Training evaluation instructions                                                                                                      |
| `content/modes/patterns.md`       | Pattern analysis instructions                                                                                                         |
| `content/modes/follow-up.md`      | Follow-up cadence instructions                                                                                                        |
| `CLAUDE.md`                       | Agent instructions                                                                                                                    |
| `*.mjs`                           | Utility scripts                                                                                                                       |
| `batch/batch-prompt.md`           | Batch worker prompt                                                                                                                   |
| `batch/batch-runner.sh`           | Batch orchestrator                                                                                                                    |
| `content/templates/*`             | Base templates                                                                                                                        |
| `fonts/*`                         | Self-hosted fonts                                                                                                                     |
| `.claude/skills/*`                | Skill definitions                                                                                                                     |
| `docs/*`                          | Documentation                                                                                                                         |
| `VERSION`                         | Current version number                                                                                                                |
| `data/schedule-state.json`        | Scheduler runtime state (`last_planned`, `last_run`, `last_result`) — system-managed, safe to delete; scheduler re-seeds on next tick |
| `data/web/`                       | Web-launcher runtime state (`web.pid`, `web.json`, `web.log`) — system-managed, safe to delete when the server is stopped             |

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
3. All reports MUST include `**URL:**` in the header. Reports generated under the v1.3+ rubric MUST also include `**Legitimacy:** {tier}`. Legacy reports written before posting-legitimacy assessment existed are exempt — do not backfill (the absence accurately reflects "not assessed").
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
