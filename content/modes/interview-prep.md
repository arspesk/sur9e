---
exec: headless
needs_tools: [web_search, web_fetch]
---

# Mode: interview-prep (company-specific interview intelligence)

When the user asks to prep for an interview at a specific company and role, or when an evaluation scores 4.0+ and the user updates status to `Interview`, run this mode.

The frontend triggers this mode through a job runner: it passes `offer #N`, the offer's URL, the company, and the role. The mode runs the research itself. Emit the finished section as ONE markdown block between `<<<SUR9E_OUTPUT>>>` /
`<<<SUR9E_END>>>` sentinels, starting with the exact heading `## Interview Process` —
the app inserts it into the report file for you; never edit the report
directly.

## Section anchor rule

Your emitted section becomes a `## Interview Process` block in the report (the app inserts it after the existing content; never edit the report yourself). The report renderer displays this section as a collapsible block and adds a matching TOC entry. The toolbar's "Interview prep" button hides once the section exists.

**Re-check the Next Steps recommendation.** If the interview intel changes the recommended action — a hiring bar to clear, a take-home to prep, a known difficult round — emit ONE updated Next Steps callout (`<div data-callout …>**Next Steps** …</div>`) ABOVE the `## Interview Process` heading inside the sentinels; the app replaces the report's leading callout with it. If the intel only adds detail without shifting the decision, emit only the section. Never emit a second callout.

`## Interview Process` is the section header (exact, case-sensitive). Everything you generate lives under it, so use `###` and `####` for the structure inside the section. These inner headings are guidance, not a machine contract: keep the hierarchy below because it reads as a clean prep handbook, but you don't need to hit exact strings.

## Section format (locked, spec §4)

The whole section is a preparation handbook. Keep every question and every prep note. The format only adds scannability through progressive disclosure (nested collapsible toggles), so the reader opens the verdict first and drills into rounds and questions on demand.

Layout:

1. **At-a-glance table first.** A small table the reader sees the moment the section opens:

   | Rounds | Days end to end | Difficulty         | Positive % |
   | ------ | --------------- | ------------------ | ---------- |
   | {N}    | {X to Y}        | {number, e.g. 3.2} | {X%}       |

   Difficulty is a **number** (e.g. `3.2`, not `3.2/5` and not stars). Positive % is the share of reviewers who reported a positive experience. If a cell is unknown, write `unknown`.

2. **Round 1 visible.** Show the first round's detail in full, directly after the table, so the reader gets concrete signal without opening anything.

3. **The rest in nested headings.** Each of these is a `###` heading under `## Interview Process`, so the reader can fold them on demand:
   - Rounds 2 to 4 (one `###` heading holding the remaining rounds)
   - Likely questions
   - Prep checklist
   - Company signals

   Individual rounds inside that heading are `####` headings (`#### Round 2: technical interview (60 min, virtual)`).

   **Stages WITHIN a round (locked format).** When a single round has internal stages (e.g. a half-day onsite with four back-to-back blocks), every stage uses the SAME shape: a bold-label paragraph followed by its bullets —

   ```markdown
   **4a. Project presentation (60 min)**

   - **Format:** …
   - **What they evaluate:** …
   ```

   Never render a stage as a heading (any level), a blockquote, or italics — one improvised `### **4c. …**` or `> 4d. …` breaks the TOC and the reader's scanning rhythm. All stages in a round must look identical.

4. **Sources collapse to one muted line per block — and every named source is a link.** Instead of a tag on every bullet, end a round or question block with a single muted line where each source name is a compact markdown link to the actual page the data came from (same format as company research): `sources: [(glassdoor)](url), [(blind)](url), inferred`. Keep the names muted lowercase, never capitalized labels. `inferred` stays a plain unlinked tag — it has no page to point to.

This mode is **company-side** intel only: process, format, known questions, hiring bar. The candidate-side STAR-story drafts already live in the eval's "STAR stories" block, so do not regenerate or duplicate those here. Skip Step 5 (story bank mapping) when running through the report-append flow; it duplicates STAR stories. Step 6 (prep checklist) stays because it's company-driven ("they ask about X, so prep X").

## Inputs

1. **Company name** and **role title** (required)
2. **Evaluation report** in `artifacts/reports/` (if exists): read for archetype, gaps, matched proof points
3. **Story bank** at `artifacts/interview-prep/story-bank.md`: read for existing prepared stories
4. **CV** at `inputs/personalization/cv.md` plus `inputs/personalization/article-digest.md`: read for proof points
5. **Profile** at `inputs/personalization/profile.yml` plus `inputs/personalization/narrative.md`: read for candidate context

## Step 1: research

Run these web-search queries. Extract structured data, not summaries. Cite sources for every claim as compact inline markdown links — `[(glassdoor)](url)`, `[(blind)](url)` — pointing at the actual page consulted, the same format company research uses.

| Query                                                       | What to extract                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `"{company} {role} interview questions site:glassdoor.com"` | Actual questions asked, difficulty rating, experience rating, process timeline, number of rounds, offer/reject ratio |
| `"{company} interview process site:teamblind.com"`          | Candid process descriptions, recent data points, comp negotiation details, hiring bar                                |
| `"{company} {role} interview site:leetcode.com/discuss"`    | Specific coding/technical problems, system design topics, round structure                                            |
| `"{company} engineering blog"`                              | Tech stack, values, what they publish about, technical priorities                                                    |
| `"{company} interview process {role}"` (general)            | Fills gaps from above: blog posts, YouTube, prep guides, candidate write-ups                                         |

If the company is small or obscure and yields few results, broaden: search for the role archetype at similar-stage companies, and note that intel is sparse.

**Do not fabricate questions.** If a source says "they asked about distributed systems," report that. Do not invent a specific distributed systems question. When you generate likely questions from JD analysis, tag them `inferred` so the reader knows they came from the JD, not from candidates.

## Step 2: at-a-glance table

Open the section with one small table:

```markdown
### Overview

| Rounds | Days end to end | Difficulty | Positive % |
| ------ | --------------- | ---------- | ---------- |
| {N}    | {X to Y}        | {number}   | {X%}       |
```

Difficulty is a plain number (e.g. `3.2`), not `3.2/5` and not stars. Positive % is the share of reviewers who reported a positive experience. If a cell is unknown, write `unknown`. Emit Difficulty and Positive % as **plain values** — the normalizer tier-colors them automatically (same treatment as the TL;DR score table): Difficulty is greener when lower (easier interview — `< 2.5` green, `2.5-3.5` yellow, `> 3.5` red); Positive % is greener when higher (`≥ 60` green, `40-59` yellow, `< 40` red). Do not hand-wrap them in `<mark>`. Below the table, add one short line naming where the timeline and quirks come from — bold the **round count**, the headline difficulty, and any known quirk so the line scans. For example: "Five rounds across **three to four weeks**, format runs recruiter screen, technical phone, take-home, onsite, hiring manager — the **four-hour take-home** is the known sticking point, and onsite is **pair programming**, not whiteboard." Carry **1-3 scan-anchors** on that line. End with one muted sources line whose source names link to the pages the table data came from, e.g. `sources: [(glassdoor)](url), [(blind)](url)`. Headline stats (the difficulty number, the round count) may additionally carry an inline `[(source)](url)` right after the claim, mirroring research mode.

## Step 3: rounds

Show **Round 1 in full** directly after the table. Put **Rounds 2 to 4 under a nested `### Rounds 2 to 4` heading** so the reader can fold them on demand. Keep all the round detail you found.

For each round:

```markdown
#### Round 1: technical phone screen (45 min)

- **Conducted by:** a **senior engineer** on the hiring team.
- **What they evaluate:** **data-structures fluency** and whether you narrate trade-offs out loud — they screen for **thinking aloud**, not just a passing solution.
- **Reported questions:**
  - One medium **array/hashmap** problem, then a follow-up on time complexity.
  - "Walk me through a system you've debugged under pressure."
- **How to prepare:** drill **medium LeetCode** with a running commentary; have one **production debugging story** ready to tell in two minutes.

sources: [(glassdoor)](https://www.glassdoor.com/Interview/...), [(blind)](https://www.teamblind.com/post/...)
```

Duration in parentheses is optional but useful (e.g. `(30 min)`, `(60 to 90 min)`). In the example prose above, bold the facts a candidate should catch fast — the **round name and count**, who runs it, the **bar they screen for**, and the **specific topic or story** to prep — so a skim of the marked spans alone tells them what this round tests (aim for 1-3 anchors per round block). Collect the per-question sources into the single muted `sources:` line at the end of the block rather than tagging each bullet — each named source linked to its page, `inferred` left plain. If round structure is unknown, say so and give the best available read on what rounds to expect from the company's size, stage, and role level.

## Step 4: likely questions

Put this whole step under a `### Likely questions` heading. Keep every question. Group them as lists under these subheadings. **Prep per audience, not just per topic** — the same loop has a recruiter screen, a hiring-manager round, peer-technical rounds, and sometimes a mixed panel, and each screens for different things. The recruiter screen is almost always the FIRST round and the one candidates under-prepare, so lead with it.

### Recruiter screen

The opening non-technical call. The recruiter is screening for fit-on-paper, motivation, logistics, and red flags — not deep technical skill. Prep the answers they actually probe:

- **Comp expectations** — give a band, not a single number, and anchor it. If comp data is thin or the candidate has no competing offer, the strongest move is to defer to the market and ask: _"I'm calibrating to market for {level} — can you share the band budgeted for this role?"_ Prep this exact deferral as the recommended opener.
- **Location / work authorization / visa** — straight from `profile.yml`; have the one-line answers ready.
- **Timeline & other processes in flight** — a confident "I'm actively interviewing and would move quickly for the right fit" reads as in-demand without overplaying.
- **"Why this company / why now"** — a 30-second motivation answer grounded in something specific about the company, not generic enthusiasm.

One muted sources line at the end of the group (linked names, as everywhere).

### Technical

Questions about system design, coding, architecture, domain knowledge.
For each: the question, and what a strong answer looks like for this candidate (reference CV proof points). One muted sources line at the end of the group (linked names, as everywhere).

### Behavioral

Questions about leadership, conflict, collaboration, failure.
For each: the question and which story from `story-bank.md` maps best.

### Role-specific

Questions tied to this job description (archetype-aware).
For each: the question, the JD requirement it maps to, and the candidate's best angle.

### Background questions

Questions the interviewer will probably ask about gaps, transitions, or unusual elements in the candidate's background. Read `inputs/personalization/narrative.md` and `inputs/personalization/cv.md` to find what might raise questions.
For each: the likely question, why it comes up, and a recommended framing that is honest, specific, and forward-looking.

Close the group with one muted sources line — linked source names, `inferred` questions tagged with the plain `inferred` tag.

## Step 5: story bank mapping

| #   | Likely question or topic | Best story from story-bank.md | Fit                      |
| --- | ------------------------ | ----------------------------- | ------------------------ |
| 1   | ...                      | [Story title]                 | strong, partial, or none |

- **strong**: story directly answers the question
- **partial**: story is adjacent, needs reframing
- **none**: no existing story, flag for the user

For each gap, suggest: "You need a story about {topic}. Consider: {specific experience from inputs/personalization/cv.md that could become a STAR+R story}."

If the user wants to draft missing stories, help them build STAR+R format and append to `artifacts/interview-prep/story-bank.md`.

## Step 6: prep checklist

Put this under a `### Prep checklist` heading. It's a **task list** (checkboxes), based on what the company actually tests, not generic advice:

```markdown
- [ ] {topic}. Why: {evidence from research}
- [ ] {topic}. Why: {their blog or product suggests this matters}
- [ ] {topic}. Why: {asked in N of M recent glassdoor reviews}
```

Prioritize by frequency and relevance to the role. Max 10 items.

## Step 7: company signals

Put this under a `### Company signals` heading. Things to say, do, and avoid based on research:

- **Values they screen for:** name them, link the source — `[(careers page)](url)`, `[(blog)](url)`, `[(glassdoor)](url)`
- **Vocabulary to use:** terms the company uses internally, which shows homework (Stripe says "increase the GDP of the internet"; Anthropic says "safety" not "alignment")
- **Things to avoid:** specific anti-patterns flagged in interview reviews
- **Questions to ask them:** 2 to 3 sharp questions that show you researched the company, tied to recent news or blog posts from Step 1

## Output

Save the full report to `artifacts/interview-prep/{company-slug}-{role-slug}.md` with this header:

```markdown
# Interview intel: {Company}, {Role}

**Report:** {link to evaluation report if exists, or "N/A"}
**Researched:** {YYYY-MM-DD}
**Sources:** {N} glassdoor reviews, {N} blind posts, {N} other
```

## Post-research

After delivering the report:

1. Ask the user if they want to draft stories for any gaps found in Step 5.
2. If they have a scheduled interview date, note it: "Your interview is in {X} days. Want me to set a reminder to review this prep?"
3. Suggest running `/research` if the company research in Step 1 was thin. It covers strategy, culture, and competitive landscape in more depth.

## Writing style

Follow the **Report writing style** and **Report markdown contract** in `_shared.md`: bare sentence-case headings, conclusion first in every block, no puffery, plain language with the candidate's domain terms, one label per concept. Actively bold the scannable, decision-driving words in every block's prose — round names and counts, the hiring bar, the difficulty number, the key question themes, the story to map — so a reader skimming only the marked spans still gets the prep. Carry **1-3 scan-anchors** per substantive paragraph. Any callout uses `<div data-callout data-variant>`, never `> [!…]` or an emoji-led blockquote. If a section opens with a one-line takeaway, write it as a plain blockquote (`> …`, no leading signal emoji): a full-sentence conclusion is a blockquote takeaway, never bold or `<mark>` spanning the whole line — keep emphasis on the short labels plus the decision-driving keywords inside the sentence.

## Rules

- **Never invent interview questions and attribute them to sources.** Inferred questions get the `inferred` tag.
- **Never fabricate glassdoor ratings or statistics.** If the data isn't there, say so.
- **Cite everything, with real links.** Every question, every stat, every claim gets a source or an `inferred` tag, collapsed into the per-block muted sources line. A named source MUST be a markdown link to the actual page consulted — a bare name without a URL is not a citation.
- Generate in the language of the JD (EN default).
- Be direct. This is a working prep document, not a pep talk.
