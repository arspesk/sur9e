---
exec: headless
needs_tools: [web_search, web_fetch]
---

# Mode: negotiate (compensation negotiation strategy)

When the user asks to negotiate an offer — or picks `/negotiate` on a report, or clicks the Negotiate action — run this mode. It produces a compensation negotiation brief tailored to **this** offer and **this** candidate.

The frontend triggers this mode through the job runner: it passes `offer #N`, the offer's URL, the company, and the role. The mode does its own benchmarking. Emit the finished section as ONE markdown block between `<<<SUR9E_OUTPUT>>>` /
`<<<SUR9E_END>>>` sentinels, starting with the exact heading `## Negotiation Strategy` —
the app inserts it into the report file for you; never edit the report
directly.

## Archetype rule (read me first)

Compensation is **archetype- and market-specific — never assume a fixed role.** Read the offer's archetype, seniority, and location from the report frontmatter/body, and benchmark against the bands for THAT archetype in THAT market. Do not hardcode any role (e.g. do not assume "Solutions Engineer" comp). A Developer Advocate, a Solutions Architect, and a Forward Deployed Engineer have different bands; reflect the actual archetype on the report. If the archetype is `Off-target` or unclear, benchmark against the closest comparable title in the posting and say so.

## Section anchor rule

Your emitted section becomes a `## Negotiation Strategy` block in the report (the app inserts it after the existing content; never edit the report yourself). The report renderer shows it as a collapsible block with a TOC entry, and the toolbar's Negotiate button reflects that it exists.

**Re-check the Next Steps recommendation.** Once a negotiation brief exists, the most consequential action is usually to deliver the counter — emit ONE updated Next Steps callout (`<div data-callout …>**Next Steps** …</div>`) ABOVE the `## Negotiation Strategy` heading inside the sentinels naming that move (or walk-away below the floor); the app replaces the report's leading callout with it. Never emit a second callout.

`## Negotiation Strategy` is the section header (exact, case-sensitive). Everything you generate lives under it — use `###` and `####` for the structure inside. These inner headings are guidance, not a machine contract.

## Inputs

1. **Offer report** in `artifacts/reports/` — read the posted comp, archetype, seniority, location/work mode, and the score breakdown (especially the `compensation` axis).
2. **Profile** at `inputs/personalization/profile.yml` — read `compensation.target_range` and `compensation.acceptable_floor` (the walk-away floor), `target_roles.archetypes`, `location`. These are the candidate's actual targets — treat them as the source of truth, never invent a number.
3. **CV** at `inputs/personalization/cv.md` (+ `article-digest.md`) — read for the proof points and leverage (competing interest, scarce skills, hero metrics) that justify a counter.

## Step 1: benchmark

Establish three numbers for this archetype + seniority + market:

- **Posted** — the offer's stated comp (base, and OTE/equity if listed). If undisclosed, say so and benchmark from market.
- **Market** — current market band for the offer's archetype at this seniority and location: `search the web` (levels.fyi, Glassdoor, public salary data) and **link the source you read**. No-URL-no-claim: a market figure without a fetched source is `unverified`, not a number you guess.
- **Candidate target** — from `profile.compensation.target_range`, and the `acceptable_floor` as the walk-away.

## Step 2: write the section

Layout under `## Negotiation Strategy`:

1. **At-a-glance table first** — the reader sees this the moment the section opens:

   | Lever        | Posted | Market band | Your ask |
   | ------------ | ------ | ----------- | -------- |
   | Base         | {…}    | {…}         | {…}      |
   | Equity / OTE | {…}    | {…}         | {…}      |
   | Sign-on      | {…}    | {…}         | {…}      |

   Use `unknown` for any cell you can't source. Never fabricate a market figure — mark it `unknown` instead.

2. **The counter** (visible, directly after the table): the single number (or range) to ask for, with a one-paragraph rationale grounded in the market band + the candidate's leverage. Stay inside the candidate's `target_range`; never counter below their `acceptable_floor`. Lead with the ask as a one-line takeaway in a plain blockquote (`> Counter at $X`, no leading signal emoji), then the rationale paragraph below it. In that rationale, bold the decision points sparingly — the counter number, the market benchmark, the leverage point — so a reader skimming the bold spans gets the ask and why it holds. One to three bold spans; keep the connective prose plain and never bold a whole sentence (the one-line conclusion is the blockquote takeaway above). For example, the rationale reads: Levels.fyi puts the comparable IC at **~$165K total**, so the posted $140K base sits ~$18K below midpoint; with two competing final-rounds as leverage, countering at **$160K** stays inside the band and above the **$135K floor**.

3. **Talking points** (`###`): 3-5 concrete scripts the candidate can say, each tied to a proof point from the CV ("led 12 production launches → I'd expect the top of the band"). No generic filler.

4. **Levers beyond base** (`###`): equity refresh, sign-on, start date, remote/relocation, title/level — whichever this offer realistically has room on, given its archetype and the company stage.

5. **BATNA & walk-away** (`###`): the candidate's best alternative and the floor below which they walk (`acceptable_floor`). State it so the candidate negotiates from strength, bolding the floor figure and the walk-away verdict. For example: The **$135K floor** is firm; an offer below it is a **walk-away** given the standing final-round elsewhere. One to three bold spans per paragraph, never a whole sentence.

## Guardrails

- The appended section follows the **Report writing style** and **Report markdown contract** in `_shared.md`: bare sentence-case `###` headings, `<div data-callout data-variant>` for any callout (never `> [!…]`/emoji-led blockquote), and bold the scan-anchors in every section's prose — the comp numbers, deltas, leverage points, and walk-away verdicts — so a skim of the marked spans alone carries the negotiation. Most substantive blocks carry one to three such anchors; never mark a whole sentence (a full-sentence conclusion is a blockquote takeaway). Use the `info`/🗂️ variant when flagging closed-or-reference context. A section's one-line takeaway (e.g. the counter) goes in a plain blockquote (`> …`, no leading signal emoji), never a fully-bolded sentence.
- Use **Negotiation AI** as the model-agnostic name in any user-visible string. Don't reference specific Claude versions.
- Never invent comp numbers. Every figure is either sourced (cite it), pulled from the candidate's profile, or marked `unknown`.
- Keep it to the offer's real archetype and market: the whole point is that this is not a generic, role-hardcoded script.
