# sur9e — AI job-hunt command center

sur9e is a free, self-hosted, open-source job-hunt toolkit that runs inside
your AI coding agent (Claude Code, Codex, or OpenCode) and ships
a local web UI on top of the same data. It evaluates job offers against your
real career profile, screens cheap before evaluating deep, tailors CVs, and
tracks every application — all on your machine.

**Mission:** quality over quantity. AI gives the job-seeker velocity and
clarity, never shortcuts — sur9e will never auto-submit an application.

This file is both the **operating manual for the AI agent** (the agent IS the
CLI — read this on every session) and the **orientation doc for contributors**.
The same content lives in `AGENTS.md` for non-Claude agents; keep the two files
in sync when editing either.

**Honesty rule:** never hallucinate. If unsure, state uncertainty. Say "I don't
know" rather than guess.

## Source of truth

| Concern                        | File                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| Data contract (User vs System) | [`docs/data-contract.md`](docs/data-contract.md)                  |
| First-run onboarding           | [`docs/onboarding.md`](docs/onboarding.md)                        |
| Architecture (system flow)     | [`docs/architecture.md`](docs/architecture.md)                    |
| Setup & prerequisites          | [`docs/setup.md`](docs/setup.md)                                  |
| Personalization guide          | [`docs/customization.md`](docs/customization.md)                  |
| Bugs / feature requests        | GitHub Issues in this repo                                        |
| Your CV                        | `inputs/personalization/cv.md` (gitignored)                       |
| Your profile & targets         | `inputs/personalization/profile.yml` (gitignored)                 |
| Your archetypes & narrative    | `inputs/personalization/narrative.md` (gitignored)                |
| Your proof points              | `inputs/personalization/article-digest.md` (gitignored, optional) |
| Your ATS portals               | `inputs/personalization/portals.yml` (gitignored, optional)       |

## Session start

1. Run silent update check: `node update-system.mjs check`. If
   `update-available`, surface to the user (see Update check protocol below).
2. If required user files are missing (`inputs/personalization/cv.md`,
   `inputs/personalization/profile.yml`) → enter onboarding
   (see [`docs/onboarding.md`](docs/onboarding.md)).
3. **Wizard handshake:** if the first user message is `Set me for success, baby!`
   — the playful line `npm run setup` seeds on hand-off — match its energy, then
   run onboarding ([`docs/onboarding.md`](docs/onboarding.md)). It's the wizard's
   launch signal, not a normal request.

## Architecture

Next.js 16 (App Router, Turbopack) + React 19 frontend, Server Actions for
mutations, with a thin Node-only library layer underneath. Detail in
[`docs/architecture.md`](docs/architecture.md).

```
src/app/                  — Next.js App Router (routes + RSC pages + /api/* JSON compat)
src/features/<feature>/   — Feature-folder UI (profile, report, table, pipeline, analytics, settings)
src/components/primitives — Button, Input, Select, Card, Pill, Chip, Field, etc. (Radix-backed)
src/components/domain/    — StatusPill, ScoreChip, ActionsMenu (composed primitives)
src/components/modals/    — Apply, Screen, Evaluate, Followup, CV, CoverLetter, Research, Outreach
src/components/shell/     — Topbar, Rail, mobile-nav, chrome-effects
src/server/actions/       — Server Actions (applications, profile, settings, jobs)
src/server/revalidate.ts  — Type-safe wrapper around Next's revalidatePath
src/lib/server/           — Node-only loaders / writers / schemas (applications, profile, settings, reports, pipeline, usage, jobs)
src/lib/schemas/          — zod schemas shared by client + server
src/lib/api/              — fetchJson helper + tiny client/server bridges
src/lib/forms/            — useZodForm (rhf + zodResolver wrapper)
src/hooks/                — TanStack Query wrappers, useFocusTrap, useJobAction
src/stores/               — Zustand stores (drawer, selection, modal, toast, status-popover, etc.)
src/app/styles/           — Global CSS (tokens.css is the single source of truth for design tokens)
src/proxy.ts              — Next 16 proxy (was middleware.ts; no-op pass-through today)
inputs/personalization/   — User CV / profile / narrative / digest (gitignored)
inputs/config/            — Settings (gitignored)
content/modes/            — Agent mode prompts (one per evaluation type)
content/templates/        — PDF / CV / state templates
content/examples/         — Personalization templates new users copy from
cli/                      — Node CLI tools (doctor, verify-pipeline, generate-pdf, merge-tracker, etc.)
scripts/                  — Web launcher, setup migrations, maintainer tools
batch/                    — Headless workers: ATS portal + JobSpy scanning + screen/evaluate runners
artifacts/                — Generated reports / outreach packs / PDFs / interview-prep (gitignored)
data/                     — Runtime state (applications.md, pipeline.md, jobs/, usage.json — gitignored)
test/                     — vitest unit tests + Playwright e2e (test/e2e/)
```

Dev server: `npm run web` → http://localhost:3000

## Critical rules (always)

- **NEVER auto-push.** Force push, branch deletion, and `git push` to remote require an explicit ask. Local commits are fine — make them logically grouped and well-described.
- **NEVER auto-submit applications.** Fill forms, draft answers, generate PDFs — but always STOP before Submit/Send/Apply.
- **Offer verification = Playwright, not WebFetch.** WebFetch can be spoofed by stale caches and bot-detection redirects; only Playwright (real headless browser) gives a faithful read of the live page.
- **Don't edit `content/modes/_shared.md` for user-specific content.** Customizations go in `inputs/personalization/narrative.md` or `inputs/personalization/profile.yml`. See [`docs/data-contract.md`](docs/data-contract.md).
- **Frontend visual changes require 3-width screenshot verification.** Capture desktop (1280×800), tablet (768×1024), and mobile (375×667) before claiming UI work is done. Every surface must work at all three widths.
- **Server library logic lives in `src/lib/server/`.** Don't grow Next API route handlers or server actions with business logic — extract into a `src/lib/server/<concern>.ts` module instead. Routes + actions are thin glue that parse zod schemas and call into the server library.
- **Server Actions handle mutations.** Each lives in `src/server/actions/<resource>.ts` and calls `revalidatePath(...)` (via the typed wrapper in `src/server/revalidate.ts`) for every surface the change affects. JSON endpoints under `src/app/api/*` stay as a compat surface for scripts.
- **Reads use the right cache layer.** RSC pages call `loadX(ROOT)` directly (wrapped in React `cache()` per request). Client components use TanStack Query hooks in `src/hooks/use-*`. Cross-component UI state goes in a Zustand store in `src/stores/`.
- **Design tokens live in `src/app/styles/tokens.css`.** New colors, spacing, radii, shadows, durations, and z-index tiers go there first; component CSS consumes `var(--token)`.

## Code-quality gates (always running)

Three layers, all wired to the same `node test-all.mjs --quick` check:

| Layer                | Where                                                                    | What it does                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostToolUse hook** | [`.claude/hooks/post-edit-check.mjs`](.claude/hooks/post-edit-check.mjs) | Runs Biome on `.ts/.tsx/.mjs/.cjs/.js/.json/.css` and Prettier on `.md/.yml/.yaml` after every Edit/Write/MultiEdit. Errors come back as `additionalContext` next turn — the agent's "editor squigglies." |
| **Pre-commit hook**  | [`.githooks/pre-commit`](.githooks/pre-commit)                           | Runs `node test-all.mjs --quick` before every commit. Wired by `npm install`'s postinstall.                                                                                                               |
| **CI**               | [`.github/workflows/test.yml`](.github/workflows/test.yml)               | `npm install → npm run lint → npm run typecheck → node test-all.mjs --quick` on every PR + push to `main`.                                                                                                |

The full gate (`test-all.mjs`) covers syntax, scripts, data-contract invariants, parser fixtures, **lint + format** (Biome on TS/JS/CSS/JSON, Prettier on MD/YAML), **type-check** (`tsc` on `src/**`), and **vitest** (React + lib unit tests).

**Bypass for genuine emergencies:** `git commit --no-verify` for the pre-commit hook, `CLAUDE_SKIP_HOOK=1` for the PostToolUse hook. Use sparingly.

**npm scripts** follow a `namespace:command` convention — a bare verb for the one canonical action (`dev`, `build`, `lint`), `group:variant` when a noun has siblings. Run any with `npm run <name>`:

| Group           | Scripts                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| web             | `web` (dev) · `web:prod` · `web:tailscale` · `web:status` · `web:stop`     |
| build & quality | `build` · `build:analyze` · `lint` · `format` · `typecheck`                |
| test            | `test:quick` (full gate) · `test:unit` (vitest) · `test:e2e` (Playwright)  |
| tracker         | `tracker:verify` · `tracker:normalize` · `tracker:dedup` · `tracker:merge` |
| cv              | `cv:pdf` · `cv:sync-check`                                                 |
| update          | `update:check` · `update:apply` · `update:rollback`                        |
| jobs            | `scan` · `jobs:liveness`                                                   |
| other           | `doctor` · `setup` · `lighthouse`                                          |

## sur9e modes (route incoming requests)

| If the user...                                              | Mode                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Pastes JD or URL                                            | `evaluate-offer` (evaluate + report + tracker; PDF via tailor-cv) |
| Asks to evaluate offer                                      | `evaluate`                                                        |
| Asks to compare offers                                      | `offers`                                                          |
| Wants LinkedIn outreach                                     | `reach-out`                                                       |
| Asks for company research                                   | `research`                                                        |
| Preps for interview at specific company                     | `interview-prep`                                                  |
| Wants to generate CV/PDF                                    | `tailor-cv`                                                       |
| Wants to strengthen their CV/profile by interview           | `enrich`                                                          |
| Evaluates a course/cert                                     | `training`                                                        |
| Evaluates portfolio project                                 | `project`                                                         |
| Asks about application status                               | `tracker`                                                         |
| Fills out application form                                  | `apply`                                                           |
| Searches for new offers                                     | `npm run scan` (ATS portals + JobSpy; sources toggle in Settings) |
| Processes pending URLs                                      | `process-queue`                                                   |
| Batch processes offers                                      | `batch-evaluate`                                                  |
| Asks about rejection patterns or wants to improve targeting | `patterns`                                                        |
| Asks about follow-ups or application cadence                | `follow-up`                                                       |

## CV source of truth

`inputs/personalization/cv.md` is canonical. `inputs/personalization/article-digest.md` has detailed proof points (optional). **Read these at evaluation time** — never hardcode metrics into mode files.

## Contributing (humans and AI agents)

sur9e is built largely with AI coding agents, and AI-assisted contributions
are welcome. The rules:

- **You own what you submit.** Review and understand every AI-generated line
  before opening a PR. "The agent wrote it" is not a review.
- **Run the gate.** `npm run test:quick` must pass locally; CI runs the same
  check. New behavior needs tests; behavior-preserving refactors must prove
  nothing changed (existing tests pass unmodified).
- **Never commit user data.** Everything under `inputs/`, `data/`, and
  `artifacts/` is gitignored by design — keep it that way. Never inject test
  data into a user's real files.
- **Match the existing patterns** (see Critical rules above) instead of
  introducing parallel ones. One source of truth per concern.
- **No auto-submit features, ever.** PRs that automate the final
  Submit/Send/Apply step of a job application will be rejected — this is a
  product principle, not a style preference.
- **Accessibility is part of done.** Keyboard navigation, labels, and focus
  management ship with the feature, not after it.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full workflow and
[`SECURITY.md`](SECURITY.md) for the security posture.

## Update check protocol

On the first message of each session, run silently:

```bash
node update-system.mjs check
```

Parse the JSON output:

- `{"status": "update-available", "local": "...", "remote": "...", "changelog": "..."}` → tell the user:
  > "sur9e update available (v{local} → v{remote}). Your data (CV, profile, tracker, reports) will NOT be touched. Want me to update?"
  - If yes → `node update-system.mjs apply`
  - If no → `node update-system.mjs dismiss`
- `{"status": "up-to-date"}` → say nothing
- `{"status": "dismissed"}` → say nothing
- `{"status": "offline"}` → say nothing

The user can also say "check for updates" or "update sur9e" any time to force a check. Rollback: `node update-system.mjs rollback`.
