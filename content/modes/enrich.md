---
exec: interactive
---

# Mode: enrich — Interview to strengthen your CV & profile

Run when the user wants to deepen or strengthen their **existing** CV/profile
through a guided interview — e.g. before a big application push, or after
shipping a new project. Triggered by `/sur9e enrich` or plain language like
"interview me to improve my CV", "help me add metrics to my resume",
"strengthen my profile".

`enrich` is the **re-runnable companion to first-run onboarding**. Onboarding
(see [`docs/onboarding.md`](../../docs/onboarding.md)) gets you set up and nails
your positioning; `enrich` mines each role for quantified impact and surfaces
forgotten skills. It does NOT redo positioning/archetypes — that's onboarding's
job — unless new detail clearly changes them.

## Precondition

Read the user layer first:

- `inputs/personalization/cv.md` — the canonical CV (**required**).
- `inputs/personalization/profile.yml` — targets, comp, location, narrative.
- `inputs/personalization/narrative.md` — archetypes, adaptive framing, deal-breakers.
- `inputs/personalization/article-digest.md` — proof points (optional).

If `cv.md` is missing, don't interview from scratch — tell the user onboarding
builds the CV first and run onboarding instead. `enrich` assumes a CV exists.

## How to interview

- **Ask exactly ONE question at a time.** Never present a wall of questions;
  wait for the answer before asking the next.
- Professional, direct, specific. No corporate fluff.
- Always push for **specifics and numbers**: tools/frameworks, architecture
  decisions, and — above all — **measurable outcomes** (%, $, latency,
  throughput, team size, time saved, adoption).
- Propose when you can. If the CV implies an outcome, suggest a number and let
  the user confirm or correct ("Sounds like that roughly halved deploy time —
  what's the real figure?").

## Flow

Work role by role, most recent/impactful first. Stop early when the user has
nothing more to add.

1. **Targets check (quick).** Confirm the target roles, comp range, and location
   in `profile.yml` are still accurate; fix if not. Skip the full positioning
   pass — onboarding owns that.
2. **Achievements per role.** For each of the last 2–3 roles: "What was your
   single most impactful achievement here, and what did you build to make it
   happen?" Capture the tools/architecture.
3. **Mine for metrics.** For each achievement/project: "What was the measurable
   outcome?" If the user doesn't know, help them estimate or frame it
   qualitatively ("enabled 12 engineers to ship 3× faster").
4. **Hidden skills & proof.** "Any tools, languages, certs, side projects, or
   articles not on your CV?" Route articles/talks/case studies to proof points.

## Apply updates

Once enough new detail is collected (or the interview ends):

1. **`inputs/personalization/cv.md`** — rewrite the affected bullets to fold in
   the new metrics + keywords; append genuinely new skills. Keep clean markdown
   (Summary, Experience, Projects, Education, Skills).
2. **`inputs/personalization/profile.yml`** — update `target_roles` /
   `compensation` / `narrative` only if the interview actually changed them.
3. **`inputs/personalization/narrative.md`** — if a new project clearly maps to
   an archetype, add it to the adaptive-framing rules.
4. **`inputs/personalization/article-digest.md`** — add any proof points the
   user shared (create the file if absent).
5. Run `npm run doctor` silently to verify integrity.
6. Summarize what changed:
   > "✅ Enriched your profile:
   >
   > - **CV** — added quantified impact to N bullets; new skills: …
   > - **Proof points** — added …
   >
   > Re-run `enrich` any time you ship something new."

## Boundaries

- **Never fabricate** metrics or experience. If the user can't quantify
  something, frame it honestly or leave it qualitative — never invent a number.
- User-specific content goes ONLY in `inputs/personalization/*` — never
  `content/modes/_shared.md` (see [`docs/data-contract.md`](../../docs/data-contract.md)).
- This mode edits the user layer directly; it does not touch reports or the
  tracker.
