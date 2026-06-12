---
exec: headless
needs_tools: []
---

# Mode: cover-letter — ATS-Friendly Cover Letter Generation

## When this mode is used

- The user clicked the "Cover letter" button on a report (frontend POSTs to `/api/jobs/cover-letter`).
- An apply-form requires a cover letter and the running `apply` mode delegates to this one.

This mode produces a one-page PDF cover letter tailored to the offer's JD, mirrored stylistically with the CV (`content/modes/tailor-cv.md`).

## Inputs

- The JD URL from the offer report (already fetched by the caller; `fetch <url>` again if not in context).
- `inputs/personalization/cv.md` — single source of truth for proof points.
- `inputs/personalization/profile.yml` — name, contact, location, language preference.
- `inputs/personalization/narrative.md` — voice / tone (if present).

## Full pipeline

1. Read `inputs/personalization/cv.md` and (if present) `inputs/personalization/narrative.md`.
2. Fetch + read the JD (URL already in the prompt).
3. Detect JD language → cover-letter language (`en` default; `es` if the JD is in Spanish).
4. Detect company location → paper format (US/Canada → letter, otherwise → a4).
5. Pull 1–2 verbatim or near-verbatim quotes from the JD for the hook paragraph.
6. Map each JD requirement to a concrete proof point from `cv.md`. Skip any requirement with no honest match.
7. Compose three short body paragraphs (250–350 words total — count words):
   - **Paragraph 1 — Hook.** Reference the JD quote + bridge to one proof point. No generic openers ("I'm excited to apply for…").
   - **Paragraph 2 — Proof points.** 2–3 quantified achievements that map to JD requirements.
   - **Paragraph 3 — Close.** Exit narrative bridge ("Built and sold a business. Now applying systems thinking to {JD domain}.") + concrete next step (e.g. "Happy to share a 15-min demo of [relevant work] this week").
8. Read `name` from `inputs/personalization/profile.yml` → normalize to lowercase kebab-case → `{candidate}`.
9. Compute `{company-slug}` using the SAME rule the backend uses (lowercase, ASCII-fold accents, replace non-alphanumerics with single dashes, trim leading/trailing dashes). Examples:
   - `Sitetracker` → `sitetracker`
   - `TruMed Systems, Inc.` → `trumed-systems-inc`
   - `Carter Maddox` → `carter-maddox`
10. Build the full HTML from `content/templates/cover-letter-template.html` by replacing `{{...}}` placeholders.
11. Emit `format: {letter|a4}` then the COMPLETE final HTML between
    `<<<SUR9E_OUTPUT>>>` / `<<<SUR9E_END>>>` sentinels. The app writes the
    HTML, runs the PDF build, and names the file
    `artifacts/output/cover-letter-{candidate}-{company-slug}-{num}-{YYYY-MM-DD}.pdf`
    (`{num}` is the offer's tracker number — it keeps two offers at the same
    company from overwriting each other's letters).
12. Report: PDF path, page count (must be 1), word count.

## ATS rules

- Single column, selectable text, no headers/footers with critical info, no images-as-text.
- UTF-8.
- 1 page max.

## Design

Same visual system as the CV:

- Fonts: Space Grotesk (header) + DM Sans (body)
- Header: name (Space Grotesk 24px) + 2px gradient line `linear-gradient(to right, hsl(187,74%,32%), hsl(270,70%,45%))` + contact row
- Body: 11px DM Sans, line-height 1.55, left-aligned (not justified — better readability + ATS-friendly)
- Margins: 0.75in
- White background

## Tone

If `inputs/personalization/narrative.md` exists: match that voice exactly. Otherwise:

- Confident, concrete, no superlatives, no fluff
- Active verbs in past tense for achievements
- Specific numbers (revenue, % improvements, headcount, time saved) — never generic adjectives

**Banned words/phrases** (corporate filler that signals a templated letter): leverage, synergy, seamless, holistic, robust, spearheaded, championed, orchestrated, passionate, stakeholder alignment, data-driven, move the needle, north star, unique opportunity, perfect fit, strong track record, results-oriented, proven ability. Rewrite around the concrete action instead.

**Generic self-check (before finalizing):** re-read each sentence and ask "could this exact sentence appear in any cover letter, for any company?" If yes, it's filler — rewrite it with a specific to this candidate and this posting (a real metric, a named system, a line from the JD), or cut it.

## Honesty rule

NEVER invent achievements, skills, or numbers. Every claim must trace back to a line in `inputs/personalization/cv.md`, `inputs/personalization/narrative.md`, or `inputs/personalization/profile.yml`. If the JD asks for something the candidate doesn't have, leave it out — don't fabricate adjacency.

## HTML template

Use `content/templates/cover-letter-template.html`. Placeholders:

| Placeholder                                 | Content                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `{{LANG}}`                                  | `en` or `es`                                                                   |
| `{{PAGE_WIDTH}}`                            | `8.5in` (letter) or `210mm` (a4)                                               |
| `{{NAME}}`                                  | from `inputs/personalization/profile.yml`                                      |
| `{{PHONE}}`                                 | from `inputs/personalization/profile.yml` (omit `<span>` + separator if empty) |
| `{{EMAIL}}`                                 | from `inputs/personalization/profile.yml`                                      |
| `{{LINKEDIN_URL}}` / `{{LINKEDIN_DISPLAY}}` | from `inputs/personalization/profile.yml`                                      |
| `{{LOCATION}}`                              | from `inputs/personalization/profile.yml`                                      |
| `{{DATE}}`                                  | localized date string (e.g. `May 6, 2026` / `6 de mayo de 2026`)               |
| `{{RECIPIENT_BLOCK}}`                       | "Hiring Team — {company}" or specific name from JD; max 3 lines                |
| `{{SALUTATION}}`                            | `Dear Hiring Team,` / `Dear {name},`                                           |
| `{{BODY_PARAGRAPH_1}}`                      | Hook                                                                           |
| `{{BODY_PARAGRAPH_2}}`                      | Proof points                                                                   |
| `{{BODY_PARAGRAPH_3}}`                      | Close                                                                          |
| `{{SIGNATURE}}`                             | `Sincerely,\n\n{{NAME}}`                                                       |

## Post-generation

This mode does NOT mutate `data/applications.md` (the existing PDF column tracks CVs). The frontend detects the new file by globbing `artifacts/output/cover-letter-*-{slug}-*.pdf` and flips the report toolbar's Cover letter button into "Download cover letter".
