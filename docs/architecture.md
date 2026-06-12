# Architecture

## System Overview

```
                    ┌─────────────────────────────────┐
                    │         Claude Code Agent        │
                    │   (reads CLAUDE.md + content/modes/*.md) │
                    └──────────┬──────────────────────┘
                               │
            ┌──────────────────┼──────────────────────┐
            │                  │                       │
     ┌──────▼──────┐   ┌──────▼──────┐   ┌───────────▼────────┐
     │ Single Eval  │   │ Portal Scan │   │   Batch Process    │
     │ (auto-pipe)  │   │(scan-jobspy)│   │   (batch-runner)   │
     └──────┬──────┘   └──────┬──────┘   └───────────┬────────┘
            │                  │                       │
            │           ┌──────▼──────┐          ┌────▼─────┐
            │           │ pipeline.md │          │ N workers│
            │           │ (URL inbox) │          │ (claude -p)
            │           └─────────────┘          └────┬─────┘
            │                                          │
     ┌──────▼──────────────────────────────────────────▼──────┐
     │                    Output Pipeline                      │
     │  ┌──────────┐  ┌────────────┐  ┌───────────────────┐  │
     │  │ Report.md│  │  PDF (HTML  │  │ Tracker TSV       │  │
     │  │ (6-axis) │  │  → Playwright)│  │ (merge-tracker)  │  │
     │  └──────────┘  └────────────┘  └───────────────────┘  │
     └────────────────────────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  data/applications.md │
                    │  (canonical tracker)  │
                    └──────────────────────┘
```

## Web App (primary surface)

The Next.js 16 App Router app under `src/app/` is the day-to-day interface; the
Claude Code agent and batch worker sit behind it. Three request paths:

- **Reads (RSC pages)** — Server Components call the typed loaders in
  `src/lib/server/` directly (`loadApplications`, `loadProfile`, `loadReport`,
  …), each wrapped in React `cache()` so a single render reads any file once.
  No HTTP round-trip; the page renders from disk on the server.
- **Reads (client components)** — interactive views fetch through TanStack
  Query hooks in `src/hooks/use-*` (e.g. `use-applications`, `use-report`,
  `use-settings`), which call the JSON compat endpoints under `src/app/api/*`.
  Those handlers stay thin and delegate to the same `src/lib/server/` loaders.
- **Mutations (Server Actions)** — writes go through Server Actions in
  `src/server/actions/<resource>.ts` (applications, profile, settings, jobs).
  Each validates with a zod schema, calls a `src/lib/server/` writer, then
  revalidates every affected surface via the typed `revalidatePath` wrapper in
  `src/server/revalidate.ts`. Cross-component UI state lives in Zustand stores
  under `src/stores/`.

All business logic lives in `src/lib/server/`; routes and actions are glue.

## Evaluation Flow (Single Offer)

1. **Input**: User pastes JD text or URL
2. **Extract**: Playwright/WebFetch extracts JD from URL
3. **Classify**: Detect archetype (1 of 6 types)
4. **Evaluate**: produce the report body sections (role summary, CV match with gaps and mitigation, level strategy, comp research via WebSearch, CV personalization plan, interview prep with STAR stories)
5. **Score**: 6 axes in `score_breakdown`, each 0-5; the global score is their average:
   - `cv_match`: skills and proof-point alignment against the JD
   - `seniority`: required years of experience vs the candidate's preferred band
   - `compensation`: posted comp vs the candidate's target band
   - `domain`: role domain vs the candidate's target archetypes and domains
   - `geo`: location and work mode vs the candidate's geo posture
   - `legitimacy`: confidence the posting is a real, active opening
6. **Report**: Save as `artifacts/reports/{num}-{company}-{date}.md`
7. **Track**: Write TSV to `batch/tracker-additions/`, auto-merged
8. **PDF** (separate step): Run `/sur9e tailor-cv` after reviewing the report to generate the ATS-optimized CV PDF (`cli/generate-pdf.mjs`)

## Provider Resolution & Fallback

Every mode resolves a `{provider, model, exec}` runtime through a 5-level
waterfall in `resolveModeRuntime` (`src/lib/server/providers/registry.ts`),
first match wins:

```
1. run override          (per-launch provider/model passed to the job)
2. per-mode setting       providers.modes.<id>.{platform,model}   (config.yml)
3. global default         providers.{default_provider,default_model}
4. mode front-matter      content/modes/<id>.md  default_platform: / default_model:
5. hardcoded fallback     claude + claude-sonnet-4-6
```

### Fallback pair

Alongside the primary, `resolveModeRuntime` resolves an optional fallback
`{provider, model}` through a parallel 3-level waterfall (independent of where
the primary resolved):

```
per-mode  providers.modes.<id>.fallback  →  global  providers.fallback  →  none
```

Dropped when identical to the resolved primary; malformed entries are ignored
(never blocks primary resolution).

### Retry-once semantics

`batch/lib/llm.mjs#runModeLLM` is the single choke point every LLM spawn flows
through. On a failed run it classifies the merged `stdout + stderr` via
`cli/classify-error.mjs` and, if the category is **retryable** and a distinct
fallback exists, re-runs the LLM call **once** with the fallback pair — only
the LLM call, never the surrounding job chain (no duplicate merge-tracker or
PDF runs).

```
retryable  →  model_not_found · rate_limit · overloaded · quota · install
never      →  auth · context_overflow · unknown · timeouts
```

All three CLIs (claude, codex, opencode) already retry transient errors
internally, so the fallback only fires after those internal retries are
exhausted. `auth` surfaces (user must re-login); `context_overflow` would fail
again; `unknown` is excluded by the model-related-only rule; timeouts are not
retried (a retry would double a multi-minute hang).

On a fallback attempt `runModeLLM` emits a `[FALLBACK]` marker line on stdout.
The job runner (`src/lib/server/jobs/runner.ts`) scans for it alongside
`[USAGE]` and re-stamps the job record so `provider`/`model` reflect the pair
that actually ran (`[USAGE]` already carries the real model, so spend
attribution stays correct).

## Batch Processing

The batch system processes multiple offers in parallel:

```
batch-input.tsv    →  batch-runner.sh  →  N × claude -p workers
(id, url, source)     (orchestrator)       (self-contained prompt)
                           │
                    batch-state.tsv
                    (tracks progress)
```

Each worker is a headless Claude instance (`claude -p`) that receives the full `batch-prompt.md` as context. Workers produce:

- Report .md
- PDF (only when `--generate-pdfs` flag is passed; off by default)
- Tracker TSV line

The orchestrator manages parallelism, state, retries, and resume.

## Scheduled Scans

A 60-second ticker started once from `src/instrumentation.ts` (Next.js instrumentation hook, Node runtime only) drives automatic portal scans. The scheduler reads `scanning.schedule` from settings on every tick — no restart needed to pick up changes.

**Awake-server requirement:** the scheduler only runs while the Next.js server is running. There is no OS-level cron involvement; scans do not fire while the machine is asleep or the server is stopped.

**Catch-up:** on server start, a missed window younger than `catch_up_hours` (default 24h) triggers one run. Multiple missed windows collapse to one — no scan-storm after a week away. Misses older than the grace window are forfeited.

**Retry on conflict:** if a scan or batch-evaluate job is already running when a window comes due, the tick records `skipped` and retries every following minute until the window is satisfied or its age exceeds the grace period.

**Screen-only chain:** the scheduler spawns the existing `scan` job kind (`scan-portals.mjs && scan-jobspy.mjs && screen.mjs && merge-tracker.mjs`). The two scanners each self-gate on `scanning.sources.{ats,jobspy}` (a disabled or unconfigured source no-ops without failing the chain), then the cheap Haiku screen pass runs — never an unattended full evaluation. Screened offers appear in the tracker ready for a manual Batch Evaluate.

State persists in `data/schedule-state.json` (`last_planned`, `last_run`, `last_result`). The file is system-managed and safe to delete — the scheduler re-seeds on the next tick.

## Data Flow

```
inputs/personalization/cv.md                    →  Evaluation context
inputs/personalization/article-digest.md        →  Proof points for matching
inputs/personalization/profile.yml              →  Candidate identity + search terms/locations (both scanners)
inputs/personalization/portals.yml              →  ATS portal company list (tracked_companies)
content/templates/states.yml                     →  Canonical status values
content/templates/cv-template.html               →  PDF generation template
```

## File Naming Conventions

- Reports: `{###}-{company-slug}-{YYYY-MM-DD}.md` (3-digit zero-padded)
- PDFs: `cv-candidate-{company-slug}-{YYYY-MM-DD}.pdf`
- Tracker TSVs: `batch/tracker-additions/{id}.tsv`

## Directory Layout

```
src/                    Next App Router root (framework code)
  app/                  Next pages + API route handlers (thin glue)
  components/           Shared UI components
  features/             Feature-scoped page components
  hooks/                React hooks
  lib/                  Shared utilities
    server/             Typed server library (12+ modules + jobs/)
    schemas/            Zod schemas (one per persisted shape)
    analytics/          Analytics compute helpers
    api/                API client helpers
  stores/               Zustand stores

cli/                    Node CLI scripts (run with node/tsx, not bundled)
batch/                  Python + shell batch processing subsystem
scripts/                One-shot migration + utility scripts
test/                   Integration + fixture tests
data/                   Runtime data (applications.md, usage.json, jobs/)
inputs/personalization/        User-specific files (gitignored)
content/modes/                  Claude mode prompts
```

## Forms (react-hook-form + Zod)

All multi-field forms use `react-hook-form` orchestrated by the
`useZodForm` helper in `src/lib/forms/use-zod-form.ts`. Validation
schemas live next to the feature: `src/features/<feature>/schemas.ts`
extends the canonical server schema from `src/lib/schemas/<entity>.ts`
with UI-specific refinements (error messages, cross-field rules).

Pattern:

```tsx
import { FormProvider } from "react-hook-form";
import { useZodForm } from "@/lib/forms";
import { ProfileFormSchema } from "./schemas";

function ProfileForm() {
  const form = useZodForm(ProfileFormSchema, { defaultValues });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSave)}>
        <IdentitySection /> {/* uses useFormContext internally */}
        <TargetsSection />
        {/* ... */}
      </form>
    </FormProvider>
  );
}
```

Section components consume the form context via `useFormContext` —
no prop drilling. API routes continue to validate via the canonical
`lib/schemas/*` (no UI messages); feature schemas extend with friendly
error text.

## Pipeline Integrity

Scripts maintain data consistency:

| Script                       | Purpose                                         |
| ---------------------------- | ----------------------------------------------- |
| `cli/merge-tracker.mjs`      | Merges batch TSV additions into applications.md |
| `cli/verify-pipeline.mjs`    | Health check: statuses, duplicates, links       |
| `cli/dedup-tracker.mjs`      | Removes duplicate entries by company+role       |
| `cli/normalize-statuses.mjs` | Maps status aliases to canonical values         |
| `cli/cv-sync-check.mjs`      | Validates setup consistency                     |
