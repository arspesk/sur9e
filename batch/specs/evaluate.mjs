// batch/specs/evaluate.mjs
//
// Full-evaluation spec. The model emits the ENTIRE report document
// (frontmatter + locked body sections per content/modes/evaluate.md) inside
// the sentinel pair; Node validates it, forces the Node-owned identity
// fields, overwrites the offer's existing report file, and writes the
// tracker TSV merge-tracker --re-eval consumes. The post-job normalizer
// (runner.ts) heals body markdown afterwards.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchJobDescription } from "../jd-fetcher.mjs";
import { jdBlock, readOptional } from "../lib/inputs.mjs";
import { findOfferRow } from "../lib/offers.mjs";
import { extractSentinelPayload } from "../lib/output-parser.mjs";
import { toIsoDate } from "../lib/posted-date.mjs";
import {
  extractNamedSections,
  parseReportFile,
  serializeReportFile,
  stripFrontMatter,
  upsertSection,
} from "../lib/report-file.mjs";
import { companySlug } from "../lib/slug.mjs";

const AXES = ["cv_match", "seniority", "compensation", "domain", "geo", "legitimacy"];
const REQUIRED = [
  "company",
  "role",
  "archetype",
  "seniority",
  "work_mode",
  "score",
  "score_breakdown",
];

// Identity guard: the model must be evaluating THE SAME COMPANY the
// tracker row names. Caught live: agy truncated/ignored the
// inlined JD and "evaluated" a fictional Weights & Biases offer onto
// Sift's row — structurally perfect frontmatter, wrong identity, and it
// overwrote the report + tracker before anyone noticed. Token-overlap
// check: accept refinements ("Anduril Industries" -> "Anduril",
// "Otter" -> "Otter.ai"), reject disjoint names.
export function companiesMatch(trackerCompany, modelCompany) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const a = norm(trackerCompany);
  const b = norm(modelCompany);
  if (!a || a === "unknown") return true; // nothing trustworthy to compare against
  if (!b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const at = new Set(a.split(" ").filter((w) => w.length >= 3));
  return b.split(" ").some((w) => w.length >= 3 && at.has(w));
}

const evaluateSpec = {
  modeId: "evaluate",
  timeoutMs: 900000, // full evaluations run 5-10 min

  async loadInputs(ctx) {
    const offer = findOfferRow(ctx.rootPath, ctx.num);
    if (!offer) throw new Error(`offer #${ctx.num} not found in data/applications.md`);
    if (!offer.url) throw new Error(`offer #${ctx.num} report has no url in frontmatter`);
    const cv = readFileSync(join(ctx.rootPath, "inputs/personalization/cv.md"), "utf-8");
    const profile =
      readOptional(join(ctx.rootPath, "inputs/personalization/profile.yml")) ||
      "# (profile.yml missing — score axes with neutral assumptions)";
    const narrative = readOptional(join(ctx.rootPath, "inputs/personalization/narrative.md"));
    const shared = readFileSync(join(ctx.rootPath, "content/modes/_shared.md"), "utf-8");
    const modeBody = stripFrontMatter(
      readFileSync(join(ctx.rootPath, "content/modes/evaluate.md"), "utf-8"),
    );
    const jd = await fetchJobDescription(offer.url);
    return { offer, cv, profile, narrative, shared, modeBody, jd };
  },

  buildPrompt(ctx, { offer, cv, profile, narrative, shared, modeBody, jd }) {
    const jdText = jdBlock(jd);
    return `You are running the sur9e "evaluate" mode headlessly — the ultimate
JD evaluation. The mode contract follows, then the shared report contract,
then every LOCAL input inlined. The shared "Tool conventions" section tells
you how your CLI exposes web capabilities; use them.

RESEARCH ON THE WEB — this is what makes the evaluation deep, not shallow:
- JD acquisition ladder for the offer URL below (a pre-fetched copy is inlined
  at the end as a floor, but it may be partial — a "__JD_INCOMPLETE__" marker
  means it is):
  1. \`render <url> in a browser\` — most portals (Lever, Ashby, Greenhouse,
     Workday) are SPAs whose body is JS-mounted; capture the rendered JD and
     any live signals (apply-button state, closed/404 banners).
  2. \`fetch <url>\` — for static career pages.
  3. \`search the web for "<role> <company>"\` — find a secondary portal that
     indexes the JD in static HTML.
  4. Fall back to the inlined pre-fetched JD. If it is "__JD_INCOMPLETE__"
     too, score the offer low-confidence per the contract — never invent JD
     content you could not read.
- Comp + legitimacy: \`search the web\` for market-comp comparables and any
  legitimacy signals (recent layoffs, reposting). HONESTY RULE: every external
  claim must carry the source link to the page you actually read. If you could
  not fetch a source, write "unverified" — do NOT state a benchmark, a
  Levels.fyi/Glassdoor figure, or a company fact you did not verify this run.

OUTPUT — your ONLY deliverable is the complete report document (YAML
frontmatter + markdown body, exactly as the mode contract specifies) emitted
between the sentinels:

<<<SUR9E_OUTPUT>>>
---
…frontmatter…
---

…body…
<<<SUR9E_END>>>

Nothing after the closing sentinel. Do NOT write any file, TSV, or PDF — the
app derives all of those from your document. The CV, profile, and narrative
below are inlined — do NOT search the filesystem, other projects, logs, or
transcripts for those LOCAL inputs, and do NOT read or write project files;
the only place you reach out is the WEB, for the research above. Do NOT
include num/status/state in frontmatter; the app injects them.

==================== MODE CONTRACT (content/modes/evaluate.md) ====================
${modeBody}

==================== SHARED REPORT CONTRACT (content/modes/_shared.md) ====================
${shared}

==================== CANDIDATE CV ====================
${cv}

==================== CANDIDATE PROFILE (yaml) ====================
${profile}
${narrative ? `\n==================== CANDIDATE NARRATIVE ====================\n${narrative}\n` : ""}
==================== OFFER ====================
- Offer #: ${offer.num} (re-evaluation of an EXISTING tracker entry)
- Company: ${offer.company}
- Role: ${offer.role}
- URL: ${offer.url}

==================== JOB DESCRIPTION (pre-fetched FLOOR — prefer a live read) ====================
${jdText}`;
  },

  parse(stdout) {
    const payload = extractSentinelPayload(stdout);
    const { frontmatter, body } = parseReportFile(payload);
    for (const f of REQUIRED) {
      if (frontmatter[f] == null || frontmatter[f] === "") {
        throw new Error(`evaluate frontmatter missing required field: ${f}`);
      }
    }
    const sb = frontmatter.score_breakdown;
    for (const axis of AXES) {
      if (typeof sb?.[axis] !== "number") {
        throw new Error(`evaluate frontmatter score_breakdown missing axis: ${axis}`);
      }
    }
    if (typeof frontmatter.score !== "number" || frontmatter.score < 0 || frontmatter.score > 5) {
      throw new Error("evaluate frontmatter score must be a number 0-5");
    }
    if (!body.trim()) throw new Error("evaluate body is empty");
    return { frontmatter, body };
  },

  async write(ctx, { offer }, { frontmatter, body }) {
    if (!companiesMatch(offer.company, frontmatter.company)) {
      throw new Error(
        `identity mismatch: offer #${ctx.num} is "${offer.company}" but the model evaluated "${frontmatter.company}" — refusing to write (likely prompt truncation or hallucinated research)`,
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    // True posting date from the model's `posted` field, normalized to
    // YYYY-MM-DD. Absent/invalid → omitted entirely. The model used to be
    // told to put the posting date in `date`; `posted` now carries it and
    // `date` is Node-owned (the evaluation date — the tracker timeline).
    const posted = toIsoDate(frontmatter.posted);
    // Node-owned identity fields — never trusted from the model.
    const fm = {
      ...frontmatter,
      num: ctx.num,
      date: today,
      url: offer.url,
      status: "Evaluated",
      state: "evaluated",
    };
    if (posted) fm.posted = posted;
    else delete fm.posted;
    const reportAbs = join(ctx.rootPath, offer.reportPath);

    // The evaluate prompt instructs the model to emit one-line stubs (with the
    // canonical ## heading) for sections owned by other modes: Company Research
    // (/research), Interview Process (/interview-prep), Outreach (/reach-out),
    // and Negotiation Strategy (/negotiate).  Re-evaluating would overwrite any
    // real content those modes previously appended.  Extract the real sections
    // from the existing file first, then graft them back over the model stubs
    // via upsertSection (replace-or-append semantics).
    const PRESERVED_TITLES = [
      "Company Research",
      "Interview Process",
      "Outreach",
      "Negotiation Strategy",
    ];
    let preserved = [];
    try {
      if (existsSync(reportAbs)) {
        const { body: existingBody } = parseReportFile(readFileSync(reportAbs, "utf-8"));
        preserved = extractNamedSections(existingBody, PRESERVED_TITLES);
      }
    } catch {
      // first evaluate or unreadable existing file — plain overwrite is fine
    }
    let finalBody = body;
    for (const { title, sectionMarkdown } of preserved) {
      finalBody = upsertSection(finalBody, title, sectionMarkdown);
    }
    writeFileSync(reportAbs, serializeReportFile(fm, finalBody), "utf-8");

    const slug = companySlug(fm.company || offer.company);
    const score = `${Number(fm.score).toFixed(1)}/5`;
    const note =
      String(fm.tldr || "")
        .replace(/[|\t\r\n]+/g, " ")
        .trim()
        .slice(0, 120) || "evaluated";
    // 10-col TSV: `posted` (true posting date, empty when unknown) is last so
    // 9-col legacy consumers stay readable.
    const tsv = [
      ctx.num,
      today,
      String(fm.company).replace(/[|\t\r\n]+/g, " "),
      String(fm.role).replace(/[|\t\r\n]+/g, " "),
      score,
      "Evaluated",
      "❌",
      `[${ctx.num}](${offer.reportPath})`,
      note,
      posted || "",
    ].join("\t");
    const tsvPath = join(
      ctx.rootPath,
      `batch/tracker-additions/${String(ctx.num).padStart(3, "0")}-${slug}.tsv`,
    );
    writeFileSync(tsvPath, `${tsv}\n`, "utf-8");
    return {
      summary: `evaluated #${ctx.num} ${fm.company} — score ${score}, report ${offer.reportPath}`,
    };
  },
};

export default evaluateSpec;
