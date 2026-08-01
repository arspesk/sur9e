# Setup Guide

## Prerequisites

- An AI coding CLI — at least one of [Claude Code](https://claude.com/claude-code) (the most polished path), [Codex](https://github.com/openai/codex), or [OpenCode](https://opencode.ai) — installed and authenticated
- Node.js 20+ (for the web UI and CLI scripts)
- Python 3.10+ (for the batch job scanner) — on macOS the installer auto-installs this via [Homebrew](https://brew.sh) if it's missing

## Quick Start (4 steps)

### 1. Clone and install

```bash
git clone https://github.com/arspesk/sur9e.git
cd sur9e
npm run setup
```

`npm run setup` installs dependencies, then launches a short guided wizard: it provisions Playwright + the Python venv (auto-installing Python 3.10+ via Homebrew if needed), detects your AI CLI (Claude Code / Codex / OpenCode) and writes the essential settings, and offers to launch onboarding. Re-run it anytime — completed steps are skipped.

(Optional) Copy `.env.example` to `.env` only if you need to override the default port (3000). `sur9e` requires no environment variables otherwise — Claude Code handles its own auth.

### 2. Configure your profile

```bash
cp content/examples/personalization/profile.yml inputs/personalization/profile.yml
```

Edit `inputs/personalization/profile.yml` with your details: name, email, target roles, narrative, proof points.

### 3. Add your CV

```bash
cp content/examples/personalization/cv.md inputs/personalization/cv.md
```

- `inputs/personalization/cv.md` — your full CV in Markdown. The source of truth for all evaluations and generated PDFs.

(Optional) Copy `content/examples/personalization/article-digest.md` and `narrative.md` if you have portfolio proof points or want to override the default archetype framing.

(Optional) Copy `content/examples/personalization/portals.yml` to enable the **ATS portal scanner** — a zero-token scan of company career feeds (Greenhouse, Ashby, Lever, Workday, Workable):

```bash
cp content/examples/personalization/portals.yml inputs/personalization/portals.yml
```

Curate the `tracked_companies` list and toggle the ATS source in Settings → Job scanning → Sources. Without this file, scanning falls back to JobSpy only.

### 4. Start using

Boot the web UI:

```bash
npm run dev
# → http://localhost:3000
```

Or open Claude Code in this directory:

```bash
claude
```

Then paste a job offer URL or description. `sur9e` will evaluate it, generate a report, create a tailored PDF, and track it.

## Available Commands

| Action                | How                     |
| --------------------- | ----------------------- |
| Evaluate an offer     | Paste a URL or JD text  |
| Search for offers     | `npm run scan`          |
| Process pending URLs  | `/sur9e process-queue`  |
| Generate a PDF        | `/sur9e tailor-cv`      |
| Batch evaluate        | `/sur9e batch-evaluate` |
| Check tracker status  | `/sur9e tracker`        |
| Fill application form | `/sur9e apply`          |

## Verify Setup

```bash
npm run doctor          # Confirms node/playwright/python/personalization files are all in place
npm run cv:sync-check   # Cross-checks personalization vs the active CV
npm run tracker:verify  # Pipeline integrity (no orphan reports, scores valid, etc.)
npm run test:quick      # Full test gate
```
