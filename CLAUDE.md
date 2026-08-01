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
| Releases & repo automation     | [`docs/releasing.md`](docs/releasing.md)                          |
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
artifacts/                — Generated reports / CV+cover-letter PDFs / interview-prep story bank (gitignored)
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

## Code-quality gates

| Layer                | Where                                                                    | What it does                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostToolUse hook** | [`.claude/hooks/post-edit-check.mjs`](.claude/hooks/post-edit-check.mjs) | Runs Biome on `.ts/.tsx/.mjs/.cjs/.js/.json/.css` and Prettier on `.md/.yml/.yaml` after every Edit/Write/MultiEdit. Errors come back as `additionalContext` next turn — the agent's "editor squigglies." |
| **Pre-commit hook**  | [`.githooks/pre-commit`](.githooks/pre-commit)                           | Runs `npm run test:quick` before every commit. Wired by `npm install`'s postinstall.                                                                                                                      |
| **Core CI**          | [`.github/workflows/test.yml`](.github/workflows/test.yml)               | Uses Node 24 + `npm ci`, then runs the quick gate and production build as separate jobs on every PR and push to `main`.                                                                                   |

The full gate (`test-all.mjs`) covers syntax, scripts, data-contract invariants, parser fixtures, **lint + format** (Biome on TS/JS/CSS/JSON, Prettier on MD/YAML), **type-check** (`tsc` on `src/**`), and **vitest** (React + lib unit tests).

PR automation also runs a fresh-clone, data-independent Playwright smoke subset;
the user-data boundary; PR title and path-label policy; high-severity dependency
review; and CodeQL. External actions stay pinned to full commit SHAs. CodeRabbit
is conditional on its GitHub App being installed. If installed, it reviews
non-draft PRs to `main`; its findings remain actionable, but it is advisory for
merge gating and not a required check. Its request-changes workflow and
automatic/non-member chat stay disabled. During rollout, prohibit Autofix,
direct commits, stacked PRs, and code-editing chat commands. Dependabot opens
weekly npm and GitHub Actions PRs; never auto-merge them. See
[`docs/releasing.md`](docs/releasing.md) for the maintainer workflow.

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

## Development and release lifecycle

Treat each pull request as the unit of history because this repository squash-merges.
Split independent features and fixes into separate, logically scoped PRs; keep one
behavior's implementation, tests, and documentation together. Avoid both catch-all
PRs that hide multiple changes behind one title and noisy micro-PRs that separate
tightly coupled work. Publish each completed, independently reviewable PR as soon as
it is ready instead of stockpiling finished PRs for a bulk push. A dependent PR may
wait only until its base change is merged.

1. **Branch from current `main`.** Fetch first, then use a short-lived branch or
   isolated worktree. Never commit or push implementation work directly to
   `main`, and never overwrite unrelated user changes.
2. **Implement and verify locally.** Add or update tests with behavior changes.
   Before a PR, run `npm run test:quick` and `npm run build`; visual frontend
   changes also require the three screenshot widths in Critical rules.
3. **Open a reviewable PR.** Push only when explicitly asked. Use a valid
   Conventional Commit PR title, review the complete diff, and resolve
   actionable human or CodeRabbit findings. CodeRabbit is advisory. Review
   Dependabot PRs individually for compatibility and provenance; never
   auto-merge them.
4. **Wait for the protected checks.** Required checks are **Quick quality
   gate**, **Production build**, **Fresh-clone Playwright smoke**, **No private
   user data**, **Validate PR title**, **High-severity dependency gate**, and
   **CodeQL analysis**. Do not bypass, mark complete, or merge while a required
   check is pending or failing.
5. **Squash merge and clean up.** Keep the validated PR title as the squash
   header and the squash body blank. After verifying the merge, do not assume
   the PR removed its remote head branch: delete any remote or local branch only
   with explicit user authorization. Before removing a local worktree, confirm
   it is clean and contains no unique work.
6. **Let Release Please prepare releases.** Every push to `main` runs
   [`.github/workflows/release.yml`](.github/workflows/release.yml).
   Releasable Conventional Commits create or update a Release Please PR; an
   ordinary merge does not create a tag or GitHub release. `fix` and `perf`
   propose patch bumps, `feat` proposes a minor bump, and with the current
   pre-1.0 configuration a breaking change also proposes a minor bump. Other
   allowed types do not normally initiate a release. Never manually edit
   release-owned version files in an ordinary PR.
7. **Release by merging the release PR.** A maintainer reviews the proposed
   version, deterministic changelog, version-file synchronization, and checks,
   then squash-merges it. The workflow automatically creates `vX.Y.Z`, the
   GitHub release, non-AI release notes, and `sur9e.spdx.json`. Verify all four.
   Manual workflow dispatch is only for repairing the SBOM on an existing
   strict tag; it must not create a competing tag or release. This lifecycle
   does not publish npm packages, containers, or deployments.

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
- **Run the gates.** `npm run test:quick` and `npm run build` must pass before a
  PR. New behavior needs tests; behavior-preserving refactors must prove nothing
  changed (existing tests pass unmodified).
- **Protect the user-data boundary.** `src/lib/repo-path-policy.mjs` is the
  executable source of truth shared by updates and CI. Protected paths must
  never be tracked or used as test fixtures; only its enumerated scaffolding is
  exempt. Keep the policy, [`docs/data-contract.md`](docs/data-contract.md), and
  their tests aligned.
- **Use Conventional Commit PR titles.** Format:
  `<type>(<optional-scope>)!?: <description>`; allowed types are `feat`, `fix`,
  `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, and `revert`.
- **Use squash merges only.** The validated PR title must become the squash
  commit's Conventional header; only GitHub's ` (#<number>)` suffix is allowed.
  Keep the squash body blank so internal commit messages cannot affect Release
  Please. Remote enforcement is a maintainer prerequisite; do not assume it is
  enabled until the GitHub settings are verified.
- **Leave releases to Release Please.** Ordinary PRs must not manually edit
  generated release metadata. Maintainers follow
  [`docs/releasing.md`](docs/releasing.md).
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
