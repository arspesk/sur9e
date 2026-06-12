---
exec: both
needs_tools: [shell, file_read, file_write, web_fetch, web_search]
---

# Mode: evaluate-offer — Full Automatic Pipeline

> Formerly `auto-pipeline`. The old name still routes here.

When the user pastes a JD (text or URL) without an explicit sub-command, run the FULL pipeline in sequence:

> **Screening option:** if the user asks to "screen" the offer (or invokes `/sur9e screen <url>`), do NOT run this full pipeline. Run the cheap worker screener instead: `node batch/add-to-pipeline.mjs <url>` then `node batch/screen.mjs --url <url>` (a quick mini-report + 0-5 score from the screening model, written to `artifacts/reports/` with a Screened/Discarded tracker row). The screen exists to decide whether the offer is worth this full evaluation — when the screen scores well, offer to continue with the full pipeline below.

## Step 0 — Extract the JD

If the input is a **URL** (not pasted JD text), use this extraction strategy:

**Priority order:**

1. **Browser render (preferred):** Most job portals (Lever, Ashby, Greenhouse, Workday) are SPAs — `render <url> in a browser` and read the JD from the rendered page.
2. **Fetch (fallback):** For static pages (ZipRecruiter, WeLoveProduct, company career pages), `fetch <url>`.
3. **Web search (last resort):** `search the web for "<role-title> <company>"` to find secondary portals that index the JD in static HTML.

**If no method works:** Ask the candidate to paste the JD manually or share a screenshot.

**If the input is JD text** (not a URL): use it directly, no fetch needed.

**Liveness gate.** While extracting, check the posting is still live before handing off to evaluation. Closed evidence: a 404/410, an "expired" / "no longer accepting" banner, a JD body that is gone leaving only page chrome, or a hard redirect to a generic careers landing page. If the posting is **closed**, stop before evaluation — tell the candidate the link is dead, mark the pipeline entry closed, and do not run an evaluation/report/PDF on phantom content. The page snapshot captured here is reused by the evaluation's legitimacy signals.

## Step 1 — Evaluation

Run exactly like the `evaluate` mode (read `content/modes/evaluate.md` for the full report format).

## Step 2 — Save the evaluation report

Save the report as **frontmatter plus a markdown body**, the format defined in `evaluate.md` "Report file format" and rendered by the web UI editor.

1. **Frontmatter** (YAML at the top of the file): the header fields per `_shared.md` "Header field shapes", plus `score_breakdown` (the six axes on a 0-5 scale). This is the only YAML in the file. Short fields and char caps are mandatory; score_breakdown axes must vary. See "Hard rules" in evaluate.md.
2. **Markdown body** (everything below the frontmatter): plain markdown, not YAML-per-section. Each major section is a collapsible `##` heading with a **bare sentence-case section name** (for example `## Compensation`); the takeaway lives inside the section, not in the heading (per the Report markdown contract). Group sections into the five zones (verdict, fit, strategy, research, action) separated by `---` rules at that top level only. The first body block is the single **Next Steps** callout (above `## TL;DR`); then the TL;DR section: a one-line verdict, the score table (the normalizer colors it), a strongest-match `success` callout, and a watch-out `warn` callout.

Use the per-section block formats defined in `evaluate.md` and the **Report markdown contract** in `_shared.md` as the canonical reference. Do not re-specify them here. The contract governs callouts (`<div data-callout data-variant>`, never `> ✅`/`> [!…]`), the Next Steps callout, marks, bare headings, no escaping, and no `**PDF:**` body line.

Two rules to hold exactly as `evaluate.md` specifies them, because they are the ones most often dropped:

- **Next Steps first.** The single **Next Steps** callout is the very first body block (above `## TL;DR`), variant chosen from the verdict (`error`/🛑, `warn`/📭, `success`/✅, `info`/💡), body opening with a bold `**Next Steps**` label.
- **Takeaways are quotes, not full-bold sentences.** When a section opens with a one-line thesis (Compensation, Level & strategy, or any other), write it as a blockquote (`> …`). Never bold a whole sentence or line; bold only short labels and ~3 decision-driving keywords. The Role-summary Fit column and the TL;DR score table are colored by the normalizer, so emit plain tokens and plain cells.

Save to `artifacts/reports/{NNN}-{company-slug}-{YYYY-MM-DD}.md`.

**Picking `{NNN}` (REPORT_NUM):**

- **Default (new offer):** highest number found in `artifacts/reports/` + 1.
- **Re-evaluation override:** if the prompt explicitly tells you `Use REPORT_NUM=N` (or `Re-evaluate existing offer #N`), use **exactly that N**. Do NOT pick the next-available number — overwrite the existing `artifacts/reports/N-{company-slug}-{date}.md` file. The orchestrator runs `merge-tracker.mjs --re-eval=N` afterwards, which expects the tracker-addition TSV to use `num=N` so it can update row N in-place. Picking the wrong number creates orphan reports and duplicate tracker rows.

The legitimacy tier lives in the frontmatter `score_breakdown` and surfaces in the TL;DR. There is no separate Posting Legitimacy body section.

## Step 3 — Update Tracker

Write a TSV to `batch/tracker-additions/{NNN}-{slug}.tsv` and run `node merge-tracker.mjs` to update `data/applications.md`. Status MUST be `Evaluated`. Include all columns plus the Report link and `❌` for PDF (no PDF is generated by this pipeline).

> Application answers are not part of the eval. They are generated on demand by `apply` mode against the form's real questions, reusing the eval and cover-letter proof points.

**If any step fails**, continue with the remaining steps and mark the failed step as pending in the tracker.

## Output — final summary

After saving the report and updating the tracker, present a brief summary to the user:

- Report saved at `artifacts/reports/{NNN}-{company-slug}-{YYYY-MM-DD}.md`
- Tracker updated (row added to `data/applications.md`)
- **To generate the tailored CV PDF**, run `/sur9e tailor-cv` (or click the "Tailor CV" button in the dashboard). The PDF step is intentionally separate so you can review the evaluation first.
