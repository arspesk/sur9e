---
exec: headless
needs_tools: [web_search, web_fetch]
---

# Mode: deep (company research)

When this mode runs, do the research yourself and deliver the result. Emit the finished section as ONE markdown block between `<<<SUR9E_OUTPUT>>>` /
`<<<SUR9E_END>>>` sentinels, starting with the exact heading `## Company Research` —
the app inserts it into the report file for you; never edit the report
directly.

## Inputs

The job runner passes you:

- `offer #N` and the offer's URL
- `company` and `role` from the tracker row
- The offer's report file at `artifacts/reports/<num>-<slug>-<date>.md`: read it for archetype, gaps, and what the eval already covered (don't repeat it)

Also read on your own:

- `inputs/personalization/cv.md`, `inputs/personalization/profile.yml`, `inputs/personalization/narrative.md`: candidate context (used in the candidate angle callout)

## Pipeline

1. Read the existing report so you know what the eval already said about the company. The new section should add depth, not duplicate.
2. `search the web` and `fetch` the results to fill the candidate angle plus the five reference axes below. Cite sources for every concrete claim (link in markdown).
3. Compose the markdown for the new section using the structure below.
4. Emit the finished section between the sentinels with `## Company Research` as the section header (exact, case-sensitive) — the app inserts it into the report after the existing content; never edit the report yourself.
5. **Re-check the Next Steps recommendation.** If your research changes the recommended action — a culture red flag, a competitor signal, a hiring freeze — emit ONE updated Next Steps callout (`<div data-callout …>**Next Steps** …</div>`) ABOVE the `## Company Research` heading inside the sentinels; the app replaces the report's leading callout with it. If the research only adds depth without shifting the decision, emit only the section. Never emit a second callout.
6. Report: source list, word count.

## Section format (locked, spec §4)

The section headings below are guidance, not a machine contract. There's no post-processor reading them; the renderer treats this as plain markdown. Keep the structure because it reads well, but you don't need to hit exact strings.

Layout:

1. **Candidate angle first, as a callout.** It's the action the reader takes, so surface it at the top in a `<div data-callout data-variant="info" data-emoji="🎯">` block (see the Report markdown contract in `_shared.md`), not buried at the end. State which of the candidate's projects map to current company priorities and one concrete artifact they could prepare.

2. **The five reference axes as nested headings.** AI strategy, recent moves, engineering culture, likely challenges, and competitors each get a plain `###` subheading under `## Company Research`. No decorative glyphs or icons on the headings.

3. **Sources as compact links.** Inline markdown links, e.g. `[(blog)](url)`, not footnotes. Group them tightly rather than tagging every bullet.

If an axis has nothing solid, write "No public signal" under it rather than fabricating, or drop the axis. Empty padded headings are worse than missing ones.

## Output structure

The candidate angle is a callout at the top. Each axis subsection is 2 to 6 bullets of concrete facts with sources, not summaries.

```markdown
## Company Research

<div data-callout data-variant="info" data-emoji="🎯">

**Candidate angle** The candidate's **two LLM-eval projects** map straight onto the team's **RAG-quality push** this quarter. Prep one concrete artifact — a **short eval-harness demo** on their public docs corpus — to land the exit narrative on a current priority.

</div>

### AI strategy

- What products or features use AI/ML? [(source)](url)
- What's their AI stack (models, infra, tools)? [(source)](url)
- Engineering or research blog: do they publish, and what do they cover? [(source)](url)
- Notable papers, talks, public benchmarks. [(source)](url)

### Recent moves (last 6 months)

- Hires in AI, ML, product. [(source)](url)
- Acquisitions, partnerships. [(source)](url)
- Product launches, pivots. [(source)](url)
- Funding, leadership changes. [(source)](url)

### Engineering culture

- Deploy cadence, CI/CD setup. [(source)](url)
- Mono-repo or multi-repo, primary languages. [(source)](url)
- Remote-first or office-first, current return-to-office stance. [(source)](url)
- Glassdoor or blind sentiment on eng culture. [(source)](url)

### Likely challenges

- Scaling pain points (reliability, cost, latency). [(source)](url)
- Active migrations (infra, models, platforms). [(source)](url)
- Customer or employee pain points mentioned in reviews. [(source)](url)

### Competitors and differentiation

- Main competitors. [(source)](url)
- Moat or differentiator.
- How they position themselves against the competition.
```

The candidate angle is a `<div data-callout data-variant="info" data-emoji="🎯">` block per the Report markdown contract in `_shared.md`. Never use GFM/Obsidian alert syntax (`> [!callout]`) or an emoji-led blockquote.

## Constraints

- 1 page rendered (~600 to 900 words). Don't pad. Skip an axis if there's no honest signal. Empty headings are worse than missing ones.
- Cite sources for facts. Sources are inline markdown links to the actual page (glassdoor URL, blog post, press release). Bare claims without sources erode trust.
- Honest about gaps: if a question yields nothing solid, write "No public signal" rather than fabricating.
- Don't repeat content already in the eval body. The eval covers role, comp, and match; this section covers company depth.
- English by default; match the JD's language only if the JD itself is non-English (rare for tech roles).

## Writing style

Follow the **Report writing style** and **Report markdown contract** in `_shared.md`: bare sentence-case headings (no decorative glyphs), conclusion first in every block, no puffery, plain language with the candidate's domain terms, bold the scan-anchors (the decision-driving numbers, signals, and named strengths/risks in every block — aim for 1-3 per substantive paragraph), one label per concept, and the `<div data-callout data-variant="info" data-emoji="🎯">` candidate-angle callout (never `> [!callout]`).

If any axis opens with a one-line takeaway or thesis, write it as a plain blockquote (`> …`, no leading signal emoji), never a fully-bolded sentence. Inside the axis prose, bold the scan-anchors — the named hire or competitor, the funding figure, the culture red flag — so a reader skimming only the highlighted spans still catches each axis's signal. The one hard guard: never bold a whole sentence or line — a full-sentence conclusion is a blockquote takeaway, not emphasis.

## Section anchor rule

Your emitted section becomes a `## Company Research` block in the report markdown (the app inserts it). The report renderer displays it as a collapsible block titled "Company research" and adds a matching TOC entry. The toolbar's "Company research" button hides once the section exists. The header is the anchor the frontend looks for, so keep `## Company Research` exactly (case-sensitive) as the section header, but the inner headings are guidance, not a rigid contract.
