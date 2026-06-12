---
exec: headless
needs_tools: [web_search, web_fetch]
---

# Mode: contact, LinkedIn power move

When this mode runs, do the research yourself and deliver the result. Emit the finished section as ONE markdown block between `<<<SUR9E_OUTPUT>>>` /
`<<<SUR9E_END>>>` sentinels, starting with the exact heading `## Outreach` —
the app inserts it into the report file for you; never edit the report
directly. There is **no separate `artifacts/outreach/*.md` file** and no bespoke widget. Outreach is plain markdown in the report body, like every other mode in this format.

The prompt body below is the strategic playbook. The "Output" section at the bottom defines the markdown shape to append. Both the prose and the example output follow the **Report writing style** and **Report markdown contract** in `_shared.md` (bare sentence-case headings, plain language, conclusion first, no puffery, no tailing negations; callouts as `<div data-callout data-variant>`, never `> [!…]`/emoji-led blockquotes). The `⭐ Primary` marker is the sanctioned inline contact marker from the palette. The copy-ready message goes in a fenced `text` code block, so the app renders it with a one-click copy button — never a blockquote, never a callout.

---

1. **Identify targets** via web search:
   - Team's hiring manager
   - Assigned recruiter
   - 2-3 team peers (people in a similar role)
   - Interviewer (if the candidate already has an interview scheduled)

2. **Classify contact type**, asking the candidate or inferring from context:
   - **Recruiter**: person whose role is talent acquisition, sourcing, or recruiting
   - **Hiring manager**: the person who leads the hiring team
   - **Peer**: someone with a similar role on the team (indirect referral)
   - **Interviewer**: someone who will be interviewing the candidate (date known)

3. **Pick the primary target**: the person who would benefit most from the candidate being there. Use the status-aware preference rule:

   | Offer status | Preference order                  | Fallback   |
   | ------------ | --------------------------------- | ---------- |
   | `evaluated`  | hiring_manager > recruiter > peer | best-found |
   | `applied`    | hiring_manager > peer > recruiter | best-found |
   | `responded`  | hiring_manager > recruiter        | best-found |
   | `interview`  | interviewer > hiring_manager      | best-found |
   | `offer`      | hiring_manager > peer             | best-found |

   "Best-found" within a persona = highest seniority signal (Head/Director > Lead > Principal > Consultant > IC), then alphabetical.

4. **Generate the message** with a 3-sentence framework adapted to the contact type. **Voice rule (applies to all personas):** these are connect-note messages, not cold sales pitches. The goal is to start a genuine human conversation, not to prove the candidate's resume in 200 characters. Read your draft out loud. If it sounds like a sales script or a recruiter blast, rewrite it.

   ### Recruiter
   - **Sentence 1 (Fit)**: Plain-English mention of what they applied to plus domain context (e.g. "Just applied to the FDE role on the AI/GenAI side. Been doing applied AI work in fintech...")
   - **Sentence 2 (Proof)**: A grounded fit signal that does not read like a CV. Use current role context, domain, or why this motion is the right next step. Avoid stack dumps and metric strings. The CV is the place for credentials; the note is the place for narrative.
   - **Sentence 3 (CTA)**: A soft, low-pressure ask, such as "Would love to chat about what you're building" or "Open to a quick call if this is the right fit."

   ### Hiring manager
   - **Sentence 1 (Hook)**: Specific observation about their work. A post they shared, a product decision, a customer outcome they're publicly proud of. Not the JD; the JD is what everyone sees.
   - **Sentence 2 (Connection)**: A non-metric bridge to the candidate's own work, such as "I'm on the integrator side of those rails at Finturf" or "I've been wrestling with the same tradeoff in fintech". Show you understand the problem from your side, not your stats.
   - **Sentence 3 (CTA)**: A real question, not a pitch. "Curious how your team is thinking about X" or "Would love to hear how POVs run on your side."

   ### Peer (referral)
   - **Sentence 1 (Interest)**: Genuine reference to their work. A blog post, talk, open-source project, or publication.
   - **Sentence 2 (Connection)**: Something the candidate is doing in the same space (not a job pitch).
   - **Sentence 3 (CTA)**: "I've been working on similar problems at [company], would love to hear your take on [topic]"
   - **Note**: Don't ask for a job. The referral happens naturally if the conversation flows.

   ### Interviewer (pre-interview)
   - **Sentence 1 (Research)**: Reference to something specific in their work or background.
   - **Sentence 2 (Context)**: Light connection to the candidate's experience on that topic.
   - **Sentence 3 (CTA)**: "Looking forward to our conversation on [date]"
   - **Note**: Light tone, not desperate. The goal is to show you prepared.

5. **Versions**:
   - EN (default)
   - ES (if Spanish-speaking company)

6. **Alternative targets** with justification for why they're good second choices.

7. **Strategic notes**: For each message, write a 1 to 2 sentence note explaining the choice: what hook was used and why, what was deliberately avoided. bold the scan-anchors in this analysis prose — the hook itself, the leverage, the thing avoided — so a skimming candidate catches the angle without reading every word. These help the candidate edit confidently. (This emphasis lives in the analysis prose only; the sendable message text in its code block stays clean.)

8. **Sequencing**: Recommend a 3 to 5 entry timeline (Day 0, Day 5 to 7, Day 10) describing when to send each message and follow-up. Turns the pack into a playbook, not just drafts.

9. **Why this outreach**: 3 to 5 score-anchored bullets explaining why this role specifically warrants outreach work. Anchor on the report's score, archetype match, and signals the recruiter or HM would care about.

**Message rules:**

- **Default, connection-request note (cold contact, no Premium):** max 200 characters (LinkedIn's free-tier note limit as of 2024). Target 160 to 190. This is the strict default; assume the candidate is on free LinkedIn unless told otherwise.
- **Premium-only fallback:** if the candidate has explicitly stated they are on LinkedIn Premium or Sales Navigator, the connection-request note limit is 300 characters (target 240 to 290) and InMail allows a 200-char subject plus a roughly 1900-char body.
- **Warm contact (already 1st-degree connected):** the char cap does not apply. Generate a conversational direct-message-style body in the same field. Note this in the contact's rationale so the candidate sends it as a DM, not a connection request.
- Open with `Hey <first-name>,` (or `Hi <first-name>,`), plain and conversational. The opener should read like a person typing, not a template.
- Conversational, full sentences. No telegram-style abbreviations (`3yr SE`), no CV-style stack dumps (`Stack: Python, RAG, AWS`), no application reference numbers (`Applied to #12345`).
- Lead with a hook specific to the company or person: a JD detail, a blog post, a recent talk. Signals you read more than the JD.
- **No metrics, no numbers, no stats in the connect note.** Percentages, years of experience, partner counts, conversion lifts all belong in the CV or resume, not in a connection request. Numbers in a cold note signal "sales pitch", which kills response rate. The one exception is when the number is the hook itself (referencing _their_ public metric, not yours). When in doubt, leave the number out and let the CV do that job.
- No corporate-speak: avoid "passionate about", "circling back", "touching base", "just checking in", "would love the opportunity to", "thrilled to apply", "exact match", "perfect fit".
- No AI tells: avoid parallel-structure sentences in series ("I X. I Y. I Z."), avoid the pitch arc "Hook, Metric, Ask" formula being visibly applied. Read your draft out loud. If it sounds like marketing copy or a recruiter blast, rewrite it.
- Something that makes them want to reply: a real question, an observation that invites a counterpoint, or genuine curiosity about how they think about a problem.
- NEVER share the phone number.
- Contact type changes the EMPHASIS, not the structure.

## Persona research (where to look)

For each persona, attempt discovery. If you cannot honestly identify a contact, add it to the `pending` list with a one-line reason. Do NOT fabricate.

- **Recruiter**: web-search `"<company>" recruiter OR "talent acquisition" linkedin site:linkedin.com/in/`. For agency-fronted offers (Franklin Fitch, Robert Half, Carter Maddox), web-fetch the agency's specializations or team page.
- **Hiring manager**: web-search `"<company>" "<role-archetype>" "manager" OR "director" OR "head" linkedin site:linkedin.com/in/`. Also check the company's engineering blog. If end client undisclosed (recruiter-fronted), skip with reason.
- **Peer**: web-search `"<company>" "<exact-role-title>" linkedin site:linkedin.com/in/`. Bonus if they post publicly about their work.
- **Interviewer**: only if the offer's status is `interview` AND the offer's report names a specific interviewer.

## Verification (REQUIRED)

For every candidate contact, perform ONE verification fetch (web-fetch their LinkedIn profile or the company's team page) before adding to the pack. Confirm they actually work at the company / agency and the role title is current. Drop unverified candidates.

## Email discovery

Include emails ONLY when sourced from a public listing: the company's team page, conference speaker bio, GitHub commit history, public CV, or paper author block.

**Forbidden:** pattern-guessed emails like `firstname.lastname@company.com`. Omit the field instead.

## Output (REQUIRED), one `## Outreach` section between the sentinels

Emit a single `## Outreach` section between the `<<<SUR9E_OUTPUT>>>` / `<<<SUR9E_END>>>` sentinels — the app inserts it into the offer's report file for you; never edit the report yourself. Do **not** write a separate `artifacts/outreach/*.md` file.

- The section header MUST be exactly `## Outreach` (case-sensitive) so the report rail detects it.
- Top-level subsections inside the section (`### <Name>`, `### Sequencing`, `### Pending`, `### Sources`) MUST be `###` (H3). A `##` would start a new top-level section and break the body structure.
- List contacts primary-first, then by persona priority.

### Layout (locked)

1. **"Do this" lead.** One line that tells the candidate the single next move (who to reach first and why now). Bold the decision-driving phrase — the contact and the timing trigger — so the move scans (1-3 scan-anchors, never the whole line; a full-sentence conclusion is a blockquote takeaway). Then the score-anchored "why this outreach" bullets, each carrying its own bold anchor on the leverage (the score, the archetype match, the signal a recruiter or HM would care about).
2. **Per contact:**
   - An **identity line** (current title, company, LinkedIn link, and a publicly sourced email only when you have one).
   - The **message in a fenced `text` code block**, so it reads as the copy-ready unit and gets the editor's copy button.
   - A **char / framework caption** in inline code plus the framework label (`169/200 · Hook, Connection, CTA`).
   - **`Why / Avoided / alt phrasings` under a nested heading.** This is a `### Why, avoided, alt phrasings` heading per contact that holds the rationale, what was deliberately avoided, and the alternate phrasings. Each alt phrasing goes in its own fenced `text` code block — like the primary message, they are sendable units the candidate copies with one click. Keep the visible block to the identity line, message, and caption; everything else folds under this heading.
3. A **`Sequencing` table** (Day 0, Day 5 to 7, Day 10).
4. **Pending and Sources folded** into their own nested collapsibles at the end.

### Full markdown structure to append

````markdown
## Outreach

_Drafted <YYYY-MM-DD> · <X.X>/5 · <archetype> · not sent_

**Reach out to <primary name> first** — <why now, plain language; bold only the contact + the timing trigger, never the whole line>.

- <why bullet 1: bold the score-anchor, e.g. a **4.6/5** fit or a **direct archetype match**>
- <why bullet 2: mark the named signal the HM would care about>
- <why bullet 3: mark the leverage or window that makes now the moment>

### <Name>, <persona label> ⭐ Primary

**<Current title> · <Company>** · [LinkedIn](url)

```text
<message text, conversational, full sentences; see Message rules. 160 to 190 chars free / 240 to 290 Premium; mark (DM) if warm or 1st-degree. KEEP THIS CLEAN — plain text only, no bold, no markdown inside the sendable message; emphasis belongs only in the analysis prose below, never in the text the contact receives>
```

`<char count>/200` · <e.g. Hook, Connection, CTA>

### Why, avoided, alt phrasings

**Why this contact:** <rationale, full prose; bold the leverage — the contact's role power, the angle, the signal that makes them the right first move (1-3 anchors, never a whole sentence)>

**Avoided:** <what was deliberately left out and why; mark the avoided thing, e.g. left out the **metric dump** so the note reads human, not like a **sales pitch**>

**Alt phrasings**

```text
<alt 1, a different angle — plain text only, copy-ready like the primary message>
```

```text
<alt 2, a different angle>
```

### <Name>, <persona label>

<!-- Repeat the `### <Name>` contact block per contact; omit "⭐ Primary" for
     non-primary. Append "· <email>" after the LinkedIn link ONLY when the email
     is publicly sourced (team page, speaker bio, GitHub, or paper), never
     pattern-guessed. Each contact gets its own `### Why, avoided, alt phrasings`
     heading. -->

### Sequencing

| Day    | Action   |
| ------ | -------- |
| 0      | <action> |
| 5 to 7 | <action> |
| 10     | <action> |

### Pending

- <Persona>: <one-line reason a contact could not be honestly found>

<!-- Omit the entire "### Pending" heading when every persona was found. -->

### Sources

- [<label>](url)
````

If the JD is in Spanish, write the message and alt phrasings in Spanish (do not auto-translate, match only the JD's language).

## Section anchor rule

The report rail detects this mode's output by the `## Outreach` heading in the report body markdown. It renders in the body editor exactly like `## Company Research` and `## Interview Process` and gets a matching rail entry. Treat the offer as already having outreach (so the "Reach out" affordance is one-shot) once a `## Outreach` heading exists in the report file.

## Re-check the Next Steps recommendation (final step)

Once outreach is drafted, the most consequential action is usually to send the primary connect note — emit ONE updated Next Steps callout (`<div data-callout …>**Next Steps** …</div>`) ABOVE the `## Outreach` heading inside the sentinels reflecting that; the app replaces the report's leading callout with it. Use the `warn`/📭 ("don't apply yet, reach out") palette entry when the recommendation is to network before applying. Never emit a second callout. This is the report-level callout above `## TL;DR`, separate from the in-section "Do this" lead inside `## Outreach`.
