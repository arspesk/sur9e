# Mode: apply, live application assistant

Interactive mode for when the candidate is filling out an application form in Chrome. Reads what is on screen, loads prior offer context, and **drafts the application answers now** from the form's real questions. This mode is the single home for application form answers. The evaluation report no longer produces a "Draft Application Answers" section; `apply` generates them on demand here, reusing the evaluation report's proof points and the cover-letter proof points.

Both the prose and the appended `## Application answers` section follow the **Report writing style** and **Report markdown contract** in `_shared.md` (bare sentence-case headings, plain language, conclusion first, no puffery, no tailing negations; any callout is `<div data-callout data-variant>`, never `> [!…]`/emoji-led blockquote).

## Requirements

- **Browser access**: the candidate's own browser (via the CLI's browser-extension tool, e.g. Claude-in-Chrome) is the **primary** tool; a visible Playwright-driven browser is the **fallback**. See Browser selection below.
- **Without either**: the candidate shares a screenshot or pastes the questions manually.

## Browser selection

**The CLI browser-extension tool is always the primary tool for apply.** Start every form in the candidate's own browser — their sessions, their tabs, everything visible to them by default. Fall back to Playwright **only** when the extension demonstrably cannot do the job on that form:

| Fallback trigger                                                   | Example                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| The extension blocks the domain                                    | stripe.com careers pages (financial blocklist)                                      |
| The extension cannot reach the form internals after a real attempt | cross-origin iframe whose fields/file inputs never appear in the accessibility tree |
| No extension is connected and the form needs no login              | headless/remote session driving a public Greenhouse/Lever/Ashby form                |

A login wall ends the fallback: if the Playwright browser hits one (LinkedIn Easy Apply, Workday accounts), the form belongs in the candidate's browser — go back to the extension or to manual fill, never type credentials.

Always launch Playwright **headed** (visible) so the candidate watches every field land and does the final review in the same window. Submit is never clicked from either tool — see the post-apply rule below.

### Flags

`/sur9e apply [num] [--chrome|--playwright]`

- _(no flag)_ — `auto`: extension first, Playwright only on a fallback trigger above.
- `--chrome` — never fall back: if the extension can't handle the form, report why and switch to drafting answers for manual fill.
- `--playwright` — skip straight to the fallback (e.g. the candidate already knows the domain is blocked). If the form turns out to need a logged-in session, stop and say so instead of fighting a login wall.

### Form-widget playbook (learned on real ATS forms)

- **Greenhouse embeds live in an iframe** (`job-boards.greenhouse.io/embed/job_app`) — target that frame, not the top document.
- **Dropdowns are react-select**: options render as `div[role="option"]`, not `<li>` or `<option>`. Working sequence: clear the input, click, type a short filter token, wait ~1s, click the option element. Enter alone does not commit — the typed value clears on blur.
- **Option lists abbreviate**: a country list may say `US`, not `United States`. When a filter returns nothing, clear it and read the unfiltered option list before retrying.
- **Some dropdowns load options async and never populate under automation** — leave those for the candidate and name them explicitly in the handoff summary.
- **Location autocompletes** (Places-style) require selecting a suggestion; typed-but-unselected text fails validation.
- **File inputs inside extension-driven iframes are often unreachable** — that is a Playwright signal; otherwise ask the candidate to upload manually and reveal the exact tailored PDF in their file manager first.

## Workflow

```
1. DETECT     → Read active Chrome tab (screenshot/URL/title)
2. IDENTIFY   → Extract company + role from the page
3. SEARCH     → Match against existing reports in artifacts/reports/
4. LOAD       → Read the full report (proof points, STAR stories) + the cover letter if one exists
5. COMPARE    → Does the role on screen match the evaluated one? If it changed → warn
6. ANALYZE    → Identify ALL visible form questions
7. DRAFT      → For each real question, draft a personalized answer now
8. PRESENT    → Show the answers as paste-ready units
```

## Step 0, direct invocation (with offer num)

If invoked as `/sur9e apply <num> [--chrome|--playwright]` where `<num>` is a positive integer (browser flags parse per Browser selection above):

1. Look up the offer in `data/applications.md` by num.
2. Read the matching report file (path is in the tracker's "Report" column, e.g., `artifacts/reports/1251-franklin-fitch-2026-05-04.md`).
3. Skip Steps 1 to 3 below (detect, identify, search). The offer is already identified.
4. Continue from Step 3 (detect role changes) using the loaded report as the evaluated baseline.

If invoked without a num (just `/sur9e apply`), proceed from Step 1 as today.

## Step 1, detect the offer

**With a browser tool** (extension or Playwright, per Browser selection): take a snapshot of the active page. Read title, URL, and visible content.

**Without a browser tool:** ask the candidate to:

- Share a screenshot of the form (Read tool reads images).
- Or paste the form questions as text.
- Or provide company and role so we can look it up.

## Step 2, identify and search for context

1. Extract company name and role title from the page.
2. Search `artifacts/reports/` by company name (Grep case-insensitive).
3. If a match is found, load the full report (proof points and STAR stories) and the cover letter if one exists at `artifacts/cover-letters/` or in the report body.
4. If NO match is found, warn and offer to run a quick evaluate-offer first so there is an evaluation to draft from.

## Step 3, detect role changes

If the role on screen differs from the evaluated one:

- **Warn the candidate**: "The role has changed from [X] to [Y]. Do you want me to re-evaluate or adapt the answers to the new title?"
- **If adapt**: adjust the answers to the new role without re-evaluating.
- **If re-evaluate**: run a full evaluation, update the report, then draft the answers against the new role.
- **Update tracker**: change the role title in `applications.md` if applicable.

## Step 3.5, preflight gate

Before drafting anything, confirm the form is worth filling:

- **Liveness**: the form still points to an active posting — not an "applications closed", "position filled", expired, or 404/redirected-to-generic-careers page. If the posting appears **closed**, do NOT draft answers: tell the candidate the posting looks dead and ask whether to proceed anyway or stop. Never generate final answers for a closed posting unless the candidate explicitly overrides.
- **Identity match**: the visible company and role match the loaded evaluation report. A mismatch beyond a title tweak (handled in Step 3) means you may be on the wrong posting — stop and confirm with the candidate rather than drafting against the wrong offer.

## Step 4, analyze form questions

Identify ALL visible questions:

- Free-text fields (cover letter, why this role, etc.)
- Dropdowns (how did you hear, work authorization, etc.)
- Yes/No (relocation, visa, etc.)
- Salary fields (range, expectation)
- Upload fields (resume, cover letter PDF)

Draft an answer for every **real** free-text question on the form. Pull dropdown and yes/no values from `inputs/personalization/profile.yml` where known — `apply_answers` holds the recurring form answers (work authorization, sponsorship, employer/title, school/degree, remote/timezone, opt-ins), `apply_answers.additional_info` holds the user's standing one-per-line answers to popular form questions (self-identification: gender/sex, race/ethnicity, sexual orientation, transgender, disability, veteran status; plus notice period, how-did-you-hear, clearances, relocation — edited in the web app's Profile → Apply "Application Questions" section), and `eeo` holds the structured voluntary self-identification answers. Ask only for questions none of these cover, and on a "save for future use" reply append the new answer to the matching block.

**Never fabricate sensitive answers.** For legal, work-authorization, visa/sponsorship, salary/compensation, demographic, disability, veteran, criminal-background, security-clearance, relocation, and voluntary self-identification fields, use ONLY a value that is in `profile.yml` (`apply_answers` / `apply_answers.additional_info` / `eeo`) or unambiguously visible in context. If the answer is not there, do NOT guess or pattern-fill a plausible value — leave it blank, flag it as **needs candidate confirmation**, and ask the candidate the single safest clarifying question. A wrong answer on a legal or EEO field is worse than an unanswered one.

## Step 5, draft the answers

Draft each answer now, from the form's real questions. Sourcing:

1. **Report proof points**: reuse the proof points and STAR stories already in the evaluation report (role-summary evidence, the STAR blockquotes). Do not re-derive them.
2. **Cover-letter proof points**: if a cover letter exists for this offer, reuse its proof points so the form answers and the letter tell one consistent story.
3. **CV fallback**: for anything the report and letter do not cover, pull from `inputs/personalization/cv.md`.
4. **"I'm choosing you" tone**: same framework as evaluate-offer.
5. **Specificity**: reference something concrete from the JD visible on screen.

**Answer shape (from the application-answers format):**

- Each answer is **2 to 4 sentences**.
- **Bold the key proof points** (the scan anchors), nothing else.
- Each answer is a **paste-ready unit**: the candidate copies one block straight into the field.
- Rewrite the form's wording into a tight question label when the original is verbose (e.g. "Why are you interested in this role?" becomes "Why this role?").

**Output format:**

```markdown
## Application answers

_Drafted for the <Company> form · <X.X>/5 · edit before submitting_

### <Tight question label>

<2 to 4 sentence answer. Key proof points in **bold**. Paste-ready as written.>

### <Next question label>

<Answer.>

...

---

Notes:

- <Any observation about the role, a change, or a field that needs the candidate's input.>
- <Customization the candidate should review before submitting.>
```

Heading note: the section is `## Application answers` with **no lettered prefix**. (This replaces the legacy `## H. Draft Application Answers`. Nothing produces the lettered section anymore.)

**Re-check the Next Steps callout.** When you append `## Application answers` to the report file, also locate the leading Next Steps callout (the first body block, above `## TL;DR`, per `_shared.md`) and update it: once answers are drafted, the most consequential action is usually to paste them in and submit (with the tailored CV), so rewrite the callout body to reflect that and adjust its `data-variant`/emoji if the recommendation changed. Never emit a second Next Steps callout. If this run only drafts answers without writing them to the report file, skip the re-check.

The `_Drafted for the <Company> form…_` line is an italic caption, not a takeaway: keep it italic, never fully bolded. Bold stays on the per-answer scan anchors (the key proof points) — never bold a whole answer sentence.

## Step 6, post-apply (optional)

If the candidate confirms they submitted the application:

1. Update status in `applications.md` from "Evaluated" to "Applied".
2. Suggest next step: `/sur9e contact` for LinkedIn outreach.

This mode drafts and fills only. It never clicks Submit, Send, or Apply; the candidate sends the application themselves (per the project's auto-submit rule).

## Scroll handling

If the form has more questions than are visible:

- Ask the candidate to scroll and share another screenshot.
- Or paste the remaining questions.
- Process in iterations until the entire form is covered.
