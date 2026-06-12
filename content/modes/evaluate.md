---
exec: headless
needs_tools: []
---

# Mode: evaluate (full evaluation)

When the candidate pastes an offer (text or URL), evaluate it end to end and write one report: YAML frontmatter carrying the typed header fields, then a markdown body that follows the locked section formats below.

## Liveness gate (URL inputs)

Before scoring a URL offer, confirm the posting is still live. A dead link must never reach the scoring rubric — fabricating a full evaluation on phantom content wastes the report and any downstream CV/PDF. Closed evidence: a 404/410, an "expired" / "no longer accepting applications" banner, a JD body that is gone leaving only page chrome, or a hard redirect to a generic careers landing page. The acquisition ladder already renders the page and captures these signals; if the pre-fetched JD floor is marked `__JD_INCOMPLETE__` and a live read also fails, treat the posting as unreadable, not as a low-quality JD.

If the posting is **closed or unreadable**, do not run the six-axis rubric on invented content. Emit a minimal report instead: set `legitimacy: suspicious` (or the closed-posting equivalent), score the axes you genuinely can from the title/company alone (leave the rest neutral, never fabricated), and lead the body with a Next Steps callout telling the candidate the link is dead and to re-screen the company's own careers page. Never invent JD requirements, comp, or company facts you could not read.

## Step 0: archetype detection

Classify the offer into one of the candidate's profile archetypes (see `_shared.md` → "Archetype Detection"). If hybrid, name the two closest. The archetype drives:

- which proof points to prioritize in the role summary,
- how to rewrite the summary in personalization,
- which STAR stories to prepare.

## Scoring: the 6-axis `score_breakdown`

The global score is the average of six axes, each 0-5. Write all six into frontmatter `score_breakdown`. Axes must vary: if only the global score is known, set axes to `score ± 0.3` rounded to one decimal. A flat hexagon is wrong.

The six axes are `cv_match`, `seniority`, `compensation`, `domain`, `geo`, `legitimacy`. Three of them have rubrics:

### `compensation` axis rubric

Read the candidate's target band from `inputs/personalization/profile.yml` → `compensation.target_range` (e.g. `"$120K-130K"`) and walk-away floor from `compensation.acceptable_floor` (e.g. `"$90K"`). Parse the JD's posted comp (use the base or OTE midpoint when both are listed; treat unstated equity and bonus as 0). Score symmetrically around the target band. Both well-below and well-above the band hurt this axis, because above-band usually signals a senior-track role the candidate would be down-leveled into.

- `4.5-5.0`: posted comp inside the target_range (e.g. $120K-130K).
- `3.5-4.4`: within ±20% of the band (e.g. $95K-$155K for a $120-130K target). Acceptable stretch.
- `2.5-3.4`: within ±40% of the band, or posted at/below the floor. Below-floor never gets above 2.5.
- `1.5-2.4`: well off-band (e.g. $200K+ when the target is $120-130K, or below the floor by >10%).
- `0-1.4`: extreme mismatch (>2× the band ceiling, typical for Staff/Principal roles), or base <60% of `acceptable_floor`.
- Not disclosed: score `2.5` (neutral) and set the comp verdict to not-disclosed in the body. Override only with high-confidence external comp data (Levels.fyi, Glassdoor); then apply the rubric to the inferred range.

### `seniority` axis rubric

Read the candidate's preferred YoE band from `inputs/personalization/profile.yml` → `target_roles.preferred_yoe` (a string like `"2-3"`, `"5-7"`, `"0-2"`, or absent/`"any"`). Score the role's required YoE relative to that band.

- `4.5-5.0`: required YoE inside the preferred band.
- `3.5-4.4`: ±1-2 YoE outside the band (minor stretch).
- `2.5-3.4`: ±3-4 YoE outside the band (sellable but down/up-leveled; add the `If down-leveled` subsection when down-pitching).
- `1.5-2.4`: ±5-7 YoE outside the band.
- `0-1.4`: ±8+ YoE outside the band, or Director / Head-of / VP / Intern / New Grad.
- YoE not posted: infer from the title. `Junior/Entry/I` ≈ 0-2 · `Mid/II` ≈ 2-4 · `Senior/III` ≈ 4-7 · `Staff/Principal` ≈ 8+ · `Lead/Manager` ≈ leadership track.
- If `preferred_yoe` is absent or `"any"`, score on JD clarity (≥3.5 for any clearly-leveled IC role, lower for ambiguous or mismatched-track postings).

### `geo` axis rubric

Read the candidate's geo posture from `inputs/personalization/profile.yml`: `search.locations` (commute whitelist), `location.city`, `location.country`, `location.onsite_availability` (`remote`/`hybrid`/`onsite`/`open`), `location.location_flexibility` (`strict`/`flexible`/`open`). Resolve the JD's posted location and work mode, then score:

**The posting's location comes from the POSTING, never from the candidate.** When the JD text starts with a `Location (from the posting page header): …` line, that value is authoritative. NEVER use the candidate profile's city as the job's location, and ignore any page-chrome geography (search headers, similar-job listings). A header location naming only a country or state (e.g. "United States", "California, United States") with no office/onsite requirement in the JD body is a remote posting — work mode Remote, location as stated. If neither the header nor the JD states a location, leave the location field empty rather than guessing.

- `4.5-5.0`: fully Remote within `location.country`, or onsite/hybrid in a `search.locations` city. Travel ≤10%.
- `3.5-4.4`: Hybrid with the office in `search.locations`, or Remote with light travel (10-25%).
- `2.5-3.4`: Remote-eligible-but-prefers-onsite outside `search.locations` with `location_flexibility` flexible/open, or onsite/hybrid outside `search.locations` but inside `location.country` with `location_flexibility == 'open'`. Travel 25-50%.
- `1.5-2.4`: Onsite or Hybrid outside `search.locations` with `location_flexibility != 'open'`, or 50%+ travel, or "remote in select states" lists that exclude the candidate's state.
- `0-1.4`: Onsite-only outside `location.country` with no remote option, or geographically incompatible with a hard constraint (visa-required country, clearance jurisdiction the candidate can't enter).
- Guardrail: Hybrid/Onsite roles in any city not in `search.locations` score ≤3.4 even when `location_flexibility == 'open'`. Relocation is real friction. Score ≥4 only when the primary location is in `search.locations` or the role is genuinely Remote.

The other three axes (`cv_match`, `domain`, `legitimacy`) score from the CV evidence, archetype fit, and posting-legitimacy signals (see `_shared.md` → "Posting Legitimacy").

---

## Report file format

Deliver the evaluation as ONE document — YAML frontmatter then markdown body —
emitted between `<<<SUR9E_OUTPUT>>>` / `<<<SUR9E_END>>>` sentinels in your
response. The app saves it to `artifacts/reports/{NNN}-{company-slug}-{YYYY-MM-DD}.md`,
injects `num`/`status`/`state`/`url`, writes the tracker TSV, and runs the
merge — do not write any file yourself.

The file is YAML frontmatter followed by a markdown body. The web app parses the frontmatter for the header fields and renders the body as editable markdown. Write the body in the locked formats below: the renderer expects those blocks, and the body is what the reader and the downstream PDF/CV pipelines consume.

### Frontmatter

A `---` fenced block at the top of the file. Field shapes are defined in `_shared.md` → "Header field shapes". Include:

```yaml
---
company: "{company, verbatim from JD}"
role: "{role title, verbatim from JD}"
archetype: "{closest profile archetype, or Off-target}"
seniority: "{Junior | Mid | Senior | Staff | Principal}"
location: "{city name only}"
work_mode: "{Remote | Hybrid | On-site}"
comp: "{base range in K, e.g. $100K-$125K — optionally one compact (+ bonus) / (+ equity) marker, never the full OTE/equity breakdown (that detail goes in the body); omit the field if undisclosed}"
date: "{YYYY-MM-DD today — the date this evaluation runs; the app owns it}"
posted: "{YYYY-MM-DD true posting date from the JD/page — OMIT the line entirely when unknown; never guess}"
url: "{posting URL}"
company_logo: "https://www.google.com/s2/favicons?domain={company primary domain, e.g. acme.com}&sz=128"
score: { X.X } # global, the average of the six axes
legitimacy: "{high_confidence | likely_legitimate | uncertain | suspicious | scam}"
score_breakdown:
  cv_match: 0.0
  seniority: 0.0
  compensation: 0.0
  domain: 0.0
  geo: 0.0
  legitimacy: 0.0
---
```

All six `score_breakdown` axes are mandatory, on a 0-5 scale, and must vary. Posting legitimacy lives here in frontmatter and surfaces in the TL;DR; it does not get its own body section.

### Body

The body is a stack of `##` sections, grouped into five zones in this order: Verdict, Fit, Strategy, Research, Action. Put a `---` horizontal rule between zone groups only, never between subsections.

All structural markdown (callouts, marks, headings, emphasis, the Next Steps callout, forbidden syntax) follows the **Report markdown contract** in `_shared.md`. Do not re-specify it; the examples below illustrate it.

Headings are bare section names in sentence case (`## Compensation`, `## TL;DR`), per the contract. The section takeaway lives inside the section, not in the heading.

**Section takeaways are blockquotes, never full-bold sentences.** When a section opens with a one-line thesis or takeaway — Compensation, Level & strategy, and ANY other section that benefits — write it as a markdown blockquote (`> …`), not a bolded sentence. Bold is reserved for short labels and at most ~3 decision-driving keywords or phrases; never bold a whole sentence, line, or paragraph. The normalizer flags full-bold paragraphs (`over-bold`), so emit the takeaway as a quote and the model has nothing to fix.

The first body block, above `## TL;DR`, is the single **Next Steps** callout (see the contract). It is a callout, not a heading, so it never folds and is always the first thing the reader sees. Pick its variant from the verdict: `error`/🛑 do-not-apply, `warn`/📭 blocked-but-reach-out, `success`/✅ apply-now, `info`/💡 conditional. The callout body opens with a bold `**Next Steps**` label, then the single most consequential action in one or two sentences (label bold only, not the sentence).

Sell-as-senior and personalization edits adapt to the archetype. For a Forward Deployed Engineer prioritize delivery speed and client-facing proof; for a Solutions Architect prioritize systems design and integrations; for an AI SE prioritize production AI shipping; for DevRel prioritize content and community.

#### TL;DR (Verdict zone)

The only section open by default. The single **Next Steps** callout precedes it as the very first body block (above `## TL;DR`), its variant chosen from the verdict (see "first body block" above) and its body opening with a bold `**Next Steps**` label. The example below shows it in place. Order of the TL;DR section itself:

1. A one-line verdict with only the decision-driving phrases in bold (not the whole line). No callout glyph. Match this tone and this bolding density: "Forward-deployed role at an AI startup: embed with enterprise customers, ship **production Claude apps**, mentor junior FDEs. **Strong archetype fit**, reasonable comp, **watch the years-of-experience gap**."
2. A score table with columns `Axis | Score | Read`. One row per axis. The Read cell is one word (e.g. `strong`, `mid`, `stretch`). No stars; the number is the only score. Do not hand-color the cells; the normalizer marks them by tier.
3. One `success` callout naming the strongest match. Open the body with a bold `**Strongest match**` label, then the evidence — bold the decisive proof phrase inside it.
4. One `warn` callout naming the main watch-out. Open the body with a bold `**Watch-out**` label, then the caveat — bold the decisive risk inside it.

```markdown
<div data-callout data-variant="success" data-emoji="✅">

**Next Steps** Apply now. Strong archetype fit and comp inside band; lead the application with the embed-with-customers proof.

</div>

## TL;DR

Forward-deployed role at an AI startup. **Strong archetype fit**, comp inside band, the seniority ask runs **two years past** the candidate's band.

| Axis         | Score | Read    |
| ------------ | ----- | ------- |
| CV match     | 4.6   | strong  |
| Seniority    | 3.1   | stretch |
| Compensation | 4.4   | clears  |
| Domain       | 4.2   | strong  |
| Geo          | 5.0   | remote  |
| Legitimacy   | 4.5   | clean   |

<div data-callout data-variant="success" data-emoji="✅">

**Strongest match** **Three years of pre-sales SE motion** maps straight to the embed-with-customers core of the role.

</div>

<div data-callout data-variant="warn" data-emoji="⚠️">

**Watch-out** JD asks **6+ years**; the candidate sits at **4**. Pitch on output, not tenure.

</div>
```

---

#### Role summary (Fit zone)

A `JD requirement | evidence | Fit` table, at most 5 rows. The Fit cell is one PLAIN token: `direct`, `strong`, or `adjacent`. Emit the bare word — do NOT wrap it in `<mark>` or add color. The normalizer colors the Fit column by tier automatically: `direct` → green (high), `strong` → yellow (mid), `adjacent` → red (low). No intro paragraph, no verdict paragraph: the table is the section.

Then a `### Gaps` subsection holding exactly one `warn` callout. This callout is the canonical home for the domain-pivot caveat. State the pivot here once; reference it elsewhere rather than restating it.

```markdown
## Role summary

| JD requirement                  | Evidence                                      | Fit      |
| ------------------------------- | --------------------------------------------- | -------- |
| Embed with enterprise customers | Ran **30+ pre-sales engagements** at Acme     | direct   |
| Ship production LLM apps        | **Two Claude apps** live in prod, 12k-doc RAG | strong   |
| Fintech domain                  | Adjacent: payments work, **no core banking**  | adjacent |

### Gaps

For each genuine gap, triage rather than just naming it: (1) is it a **hard blocker** (a non-negotiable requirement the candidate can't meet — a required clearance, a hard-mandated language/framework with no adjacent experience) or a **nice-to-have** (preferred, coachable, or coverable by adjacent work)? (2) what adjacent experience demonstrates the underlying capability? (3) is there a portfolio project or quick win that covers it? Surface the triage as the callout's takeaway, then name the concrete mitigation (a cover-letter framing, a CV line to lead with, a short project) — a gap with no mitigation path is just discouragement.

<div data-callout data-variant="warn" data-emoji="⚠️">

**Domain pivot (nice-to-have)** The role centers on core banking; the candidate's domain is payments and SE tooling — the motion transfers cleanly, the vertical is a coachable pivot, not a blocker. Mitigation: lead with the transferable SE workflow and name the banking ramp explicitly in the cover letter.

</div>
```

#### Compensation (Fit zone)

Open with the takeaway as a blockquote (`> …`), never a full-bold sentence. Then a short evidence paragraph, then a `Source | Value` table. Pin the candidate's target band as a highlighted reference row in the table. Give one verdict signal only; do not split into separate analysis, demand, and verdict labels. Inside the evidence prose, **bold the key numbers and the verdict signal** (aim for 2-3 marked anchors a skimming reader can catch, not a single timid one).

**No-URL-no-claim.** The market-comparable row is source-neutral: name whatever source you actually read (Levels.fyi, Glassdoor, a job board) and **link it** — `[(levels.fyi)](url)`. If you did not fetch a comp source this run, the value is `unverified` and the prose says so; never state a benchmark figure you could not pull from a real page. The Posting and Target-band rows are always present (both are inlined facts).

```markdown
## Compensation

> OTE clears the target band; base alone lands just under it, so the variable split matters.

The market comparable [(levels.fyi)](https://www.levels.fyi/...) puts comparable AI SE roles near **~$180K OTE**. The posting's **$150K base + $40K variable** **clears** that once the variable lands — comp is a green light, not a negotiation lever.

| Source                                | Value                      |
| ------------------------------------- | -------------------------- |
| Posting                               | $150K base + $40K variable |
| Market comparable [(levels.fyi)](url) | ~$180K OTE                 |
| **Target band (reference)**           | **$120K-$130K**            |
```

When no comp source could be fetched, the row reads `| Market comparable | unverified |` and the prose scores the axis on the posting + band alone.

---

#### Level & strategy (Strategy zone)

Open with the level-verdict takeaway as a blockquote (`> …`), never a full-bold sentence. Then two `####` subsections as lists:

- `#### Sell as senior`: how to frame the candidate's senior-level output.
- `#### If down-leveled`: include this only when the seniority axis is a genuine stretch.

Then a copy-ready negotiation script in a code block.

````markdown
## Level & strategy

> The JD reads senior; the candidate's tenure reads mid. Win it on shipped output, not years.

#### Sell as senior

- Led **two production LLM launches** end to end, **no senior above** on either.
- Owned the pre-sales SE motion for the **top three accounts**.

#### If down-leveled

- Accept a **mid title** with a **6-month senior review** tied to a written scope.
- Hold base **at or above $150K** regardless of title.

```
Thanks. Before we talk title, I want to anchor on scope: I've owned production launches solo, which is the work this role describes. I'm open to the level that fits your bands, and I'd want base at $150K and a written six-month review against senior scope.
```
````

#### Personalization (Strategy zone)

One `####` per channel, only for channels with edits (CV, LinkedIn, and so on). Per edit: a label, a one-line why, and the paste-ready string in a code block. Cap at about 3 edits per channel.

````markdown
## Personalization

#### CV

**Summary line.** Why: mirrors the JD's lead requirement so the first scan lands.

```
Forward Deployed Engineer who ships production LLM apps embedded with enterprise customers.
```

#### LinkedIn

**Headline.** Why: recruiters search "Forward Deployed"; the current headline buries it.

```
Forward Deployed Engineer · production LLM apps · ex-Acme
```
````

#### STAR stories (Strategy zone)

At most 3 stories. Each is a `####` title, a blockquote holding the spoken-voice narrative (situation, task, action, result woven into how the candidate would tell it out loud), and an italic _Reflection_ line. Even inside the narrative blockquote, bold the result metrics so the outcome scans. The Reflection line signals seniority and must earn its place: a junior candidate describes what happened, a senior candidate extracts the lesson and what they changed because of it. Write each Reflection as a genuine learning ("I'd have caught X earlier with Y; I build that in now"), never a throwaway "it went well."

```markdown
## STAR stories

#### The account that almost churned

> The biggest enterprise account was **three weeks from churning** when their integration kept timing out. I owned the relationship, so I sat with their engineers, traced it to our batch limits, shipped a streaming path in **four days**, and walked their CTO through it live. They **renewed and expanded** the next quarter.

_Reflection: I'd have caught the batch ceiling earlier with a load test in onboarding. I build that step in now._
```

---

#### Interview Process (Research zone)

Appended by `/interview-prep`. Reference it lightly here; do not redefine its internals. If the candidate has not run interview prep yet, leave a one-line pointer that this section fills in when they run `/interview-prep`.

#### Company Research (Research zone)

Appended by `/research`. Reference it lightly here; do not redefine its internals. Point to `/research` for the candidate angle and reference axes.

---

#### Outreach (Action zone)

Appended by `/reach-out`. Reference it lightly here; do not redefine its internals. Point to `/reach-out` for the messages and sequencing.

## Hard rules

- Frontmatter carries all header fields and all six `score_breakdown` axes. Never leave an axis empty; use the rubrics above. Axes must vary.
- Body sections follow the locked formats above, in zone order (Verdict, Fit, Strategy, Research, Action), with `---` rules between zones only.
- Structural markdown follows the **Report markdown contract** in `_shared.md`: bare sentence-case headings (takeaway inside the section, not the heading), `<div data-callout data-variant>` callouts (never `> ✅`/`> [!…]`), bold (sparingly) for decision points and key terms, the single Next Steps callout first, no escaping, no `**PDF:**` line.
- Bold only short labels and the few decision-driving keywords/phrases (~3 max) in each section. NEVER bold a whole sentence, line, or paragraph. A section takeaway is a blockquote (`> …`), not a full-bold line — this holds for Compensation, Level & strategy, and any other section that opens with a thesis.
- The Role-summary Fit column and the TL;DR score table are colored by the normalizer. Emit plain Fit tokens (`direct`/`strong`/`adjacent`) and plain score/read cells; never hand-color them with `<mark>`.
- Use callouts for signals (the strongest-match `success` and watch-out `warn` in TL;DR, the `warn` Gaps caveat). Do not glue decorator emoji to running text. Never double-encode a score.
- State each fact once. The domain-pivot caveat lives in Gaps; reference it after, do not restate it.
- Writing style follows `_shared.md` → "Report writing style": conclusion first in every section, no puffery, no "X, not Y" tailing negations, no `-ing` analysis tails, prefer is/are/has, vary sentence length, one label per concept, plain language with the candidate's domain terms (POV, OTE, MEDDIC) kept as is.
- The app writes the tracker TSV and runs `merge-tracker` from your emitted
  document. Never edit `applications.md` or write a TSV yourself.
- Tracker status MUST be `Evaluated` (or `Applied` if the candidate already applied).
- Use **Evaluation AI** as the model-agnostic name in any user-visible string. Do not reference specific Claude versions.
