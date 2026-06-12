# First-run onboarding

Triggered automatically by Claude when required user files are missing — or explicitly when the setup wizard hands off with its handshake phrase (`Set me for success, baby!`) as the first message: match its energy, then run the whole onboarding. Don't proceed with evaluations, scans, or any other mode until the basics are in place.

## Step 0 — Detection

On every session start, Claude silently checks:

1. Does `inputs/personalization/cv.md` exist?
2. Does `inputs/personalization/profile.yml` exist (not just `content/examples/personalization/profile.yml`)?
3. Does `inputs/personalization/narrative.md` exist (not just `content/examples/personalization/narrative.md`)?

If `inputs/personalization/narrative.md` is missing → silently copy from `content/examples/personalization/narrative.md`. This file is the user's customization layer; updates never touch it. (Not running this through Claude? Copy it manually: `cp content/examples/personalization/narrative.md inputs/personalization/narrative.md`.)

If `inputs/personalization/cv.md` or `inputs/personalization/profile.yml` is missing → enter onboarding (the steps below). Do **not** proceed with any evaluation until onboarding completes.

## Step 1 — Doctor gate (environment must be green first)

Before asking the user for anything, verify the install actually works — failing here beats discovering it after they typed in their whole CV.

1. Run `node cli/doctor.mjs`. For every failure, give the one-line fix (`npm run setup` for missing deps/venv/playwright, "add the key to `.env`" for missing keys) and re-run until clean.
2. Check which provider the evaluation pipeline will actually use:

   ```bash
   npx tsx --conditions=react-server cli/resolve-mode.mjs evaluate
   ```

3. Verify that provider's CLI responds (e.g. `claude --version` and logged-in state for Claude; the analogous check for codex / opencode). If it doesn't, walk the user through installing/logging into that CLI — or switching the mode's provider in Settings → Providers.

**Step 5 (first win) is blocked until this gate is green.** Don't skip ahead.

## Step 2 — CV (required)

If `inputs/personalization/cv.md` is missing, ask:

> "I don't have your CV yet. You can either:
>
> 1. Paste your CV here and I'll convert it to markdown
> 2. Paste your LinkedIn URL and I'll extract the key info
> 3. Tell me about your experience and I'll draft a CV for you
>
> Which do you prefer?"

Create `inputs/personalization/cv.md` from whatever the user provides. Make it clean markdown with standard sections (Summary, Experience, Projects, Education, Skills).

## Step 3 — Profile basics (required)

If `inputs/personalization/profile.yml` is missing:

1. Copy from `content/examples/personalization/profile.yml`
2. Ask only the basics (positioning questions come in Step 4 — don't duplicate them here):

> "I need a few details to personalize the system:
>
> - Your full name and email
> - Your location and timezone
> - What roles are you targeting? (e.g. 'Senior Backend Engineer', 'AI Product Manager')
> - Your salary target range
>
> I'll set everything up for you."

Fill the answers into `candidate`, `location`, `target_roles`, and `compensation`.

## Step 4 — Draft, then correct: your positioning

This is where evaluation quality is made. Don't ask the user to describe themselves from scratch — propose, and let them correct.

1. **Read `inputs/personalization/cv.md` end to end.**
2. **Draft a positioning proposal** and write it directly into the user layer:
   - archetypes + target-role mapping → `inputs/personalization/profile.yml` (`narrative`, `target_roles`)
   - "Your Adaptive Framing", "Your Cross-cutting Advantage", "Your Negotiation Scripts" → the matching sections of `inputs/personalization/narrative.md`
3. **Present the draft and ask what's wrong:**

> "Based on your CV, here's how I'd position you: [archetypes, framing per audience, your cross-cutting advantage]. What's wrong or missing? Be brutal — this drives every evaluation score."

Iterate until the user approves.

4. **Ask the two things a CV can't reveal:**

> "Two more things I can't read from a CV:
>
> - Deal-breakers? (e.g. no on-site, no startups under 20 people, no Java shops)
> - Proof points — articles, talks, case studies, public projects I should cite when pitching you?"

Deal-breakers → `inputs/personalization/narrative.md`; proof points → `inputs/personalization/article-digest.md` (create it if the user shares any).

Store user-specific content ONLY in `inputs/personalization/*` — never in `content/modes/_shared.md` (see [`data-contract.md`](data-contract.md)).

**Tip — for later:** once they're set up, the user can run `enrich` any time to interview-mine each role for quantified impact (%, $, latency) and surface forgotten skills. It's the re-runnable companion to this positioning pass — worth pointing them to after their first win.

(Optional) If the user wants the zero-token **ATS portal scan** (company career feeds — Greenhouse, Ashby, Lever, Workday, Workable, Recruitee, SmartRecruiters, SolidJobs), copy `content/examples/personalization/portals.yml` to `inputs/personalization/portals.yml` and help them curate `tracked_companies`. Without it, scanning uses JobSpy only. The ATS / JobSpy sources are toggled in Settings → Job scanning → Sources.

## Step 5 — First win (optional): evaluate a real offer together

Requires the Step 1 gate green. Make it a real choice — some users want a win now, others want to look around first:

> "Want to evaluate a real offer together now? You'll walk away with a real scored report about your own job hunt. Drop a job URL — or say **skip** and I'll take you straight into the app."

### If they give a URL — the teaching first-win

1. **Explain the two passes first** — this is sur9e's whole thesis, don't skip it:

   > "sur9e runs two passes. First a cheap **screen** — fast triage, _is this even worth a deep look?_ Then, only on offers that survive, a deep **evaluate** — full archetype-fit scoring, comp analysis, legitimacy check, CV-match table. Pennies to filter, dollars to analyze."

2. **Offer a per-mode model choice — opt-in, don't force it.** The wizard already set sensible defaults for both passes; just ask whether to override for this run:

   > "Want to pick a different model for each mode, or use your defaults (screening on `<screen model>`, evaluating on `<default model>`)?"
   - **Use defaults** → run with the configured models, no further prompts.
   - **Customize** → fetch the available models for the active provider and let them choose per mode (screening / evaluating). Run each stage with the pick via the per-run model override (`run_override` — the same channel `cli/resolve-mode.mjs` and the job launcher honor); never edit `content/modes/`. Then offer to persist: _"Make these your defaults?"_ → if yes, write to `inputs/config/config.yml` (`providers.modes.screen.model` / `providers.modes.batch-evaluate.model`).

3. **Run the pipeline** (screen → evaluate → report → tracker row), narrating each stage as it runs: what it does, which model, roughly what it costs. The tracker file bootstraps itself on the first write — don't create it manually.

4. **Open the result in their browser.** Make sure the web UI is running (`npm run web` if :3000 is free; reuse a running one), then **open the exact report page** so they land right on their first report — `open http://localhost:3000/report/<filename>` on macOS (`xdg-open …` on Linux). Mention the tracker table too (`http://localhost:3000/table`).

If the user has no URL handy, offer the alternative first win: `/sur9e scan` — crawls their configured portals and screens every find with the cheap pass.

### If they skip — into the app, with an optional tour

1. Boot the web UI (`npm run web` if :3000 is free; reuse a running one) and **open it in their browser** (`open http://localhost:3000` on macOS, `xdg-open …` on Linux).
2. Ask before touring — don't force it:

   > "Want a quick guided tour of the app, or would you rather explore on your own?"

3. **Tour** → walk the key surfaces conversationally, one line of "what it's for + where to act" each, linking every page:
   - **Offers table** (`/table`) — every evaluated offer with scores and status
   - **Pipeline board** — kanban of where each application stands
   - **Report viewer** (`/report/<file>`) — the full evaluation per offer (editable)
   - **Settings** — providers/models, job-scanning sources + schedule, appearance
   - **Profile** — your CV, positioning, and deal-breakers (the inputs every score reads)
4. **Explore on their own** → skip the tour and go straight to the wrap below.

## Step 6 — Wrap (don't skip — close with all four beats)

This is the step agents compress the most: after a long eval it's tempting to end with a casual "you're set up" and drop the rest. **Don't.** Every onboarding — whether they evaluated or skipped — MUST close by hitting all four beats below, in order. Keep each tight (a line or two), but say all four.

1. **Recap (one line).** Confirm setup; if they evaluated, name the live report:

   > "You're set up — your CV, profile, and positioning are now wired into every future evaluation.[ Your first report is live at `http://localhost:3000/report/<filename>`.]"

   (Drop the bracketed report sentence if Step 5 was skipped.)

2. **Offer scheduled scans — ALWAYS. This is the beat that gets skipped, and it matters most:** new users won't discover auto-scanning on their own, and it's what turns sur9e from a one-shot into a daily habit. Pitch it explicitly:

   > "Want new offers found for you automatically? Say `scan schedule weekdays 9:00` — or daily / weekends / weekly. It runs scan → screen → tracker on schedule while the server's up; full evaluations always stay manual."

   If they accept, configure via Settings → Job scanning → Scheduled scans (or the `scan schedule <cadence>` sub-route), confirm the next-run time, and repeat the honesty note (server must be running; <24h missed windows catch up on next start).

3. **The learning hook (one line)** — frame sur9e as something that sharpens with their corrections:

   > "And I get sharper every time you push back — tell me _'this score's too high'_ or _'you missed my experience in X'_ and I'll rewrite your positioning and deal-breakers so every future evaluation inherits it."

   Mechanically, corrections route to the **user layer** — `inputs/personalization/narrative.md` (framing/deal-breakers) or `cv.md` / `article-digest.md` (missing experience); never the system layer (see [`data-contract.md`](data-contract.md)).

4. **One contextual next step — don't dump the whole mode list.** Name the 2–3 moves that fit what just happened: after a strong eval, the offer-specific ones (`tailor-cv`, `reach-out`, `interview-prep` for that role); after a skip or weak score, "paste any JD or URL for a full evaluation." End there.
