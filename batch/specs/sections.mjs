// batch/specs/sections.mjs
//
// Body-append section specs: research / interview-prep / outreach /
// negotiate. The model does its own web research (its CLI's native web
// search/fetch, plus the stdio Playwright MCP wired in .mcp.json /
// opencode.json / .codex/config.toml) and emits ONLY the new H2 section
// between the sentinels — optionally
// preceded by ONE updated Next Steps callout (<div data-callout …>) when
// the findings change the recommended action; Node replaces the report's
// leading callout with it. Node upserts the section into the offer's
// report body (replace-or-append, so re-runs don't stack duplicates).
// H2 titles are EXACT and case-sensitive — the renderer and
// extractAppendedSections key on them. The post-job normalizer heals the
// markdown afterwards.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findOfferRow } from "../lib/offers.mjs";
import { extractSentinelPayload } from "../lib/output-parser.mjs";
import {
  parseReportFile,
  serializeReportFile,
  stripFrontMatter,
  upsertSection,
} from "../lib/report-file.mjs";

// Leading Next Steps callout block at the very start of a payload:
// `<div data-callout …> … </div>` (non-greedy, first closing tag).
const LEADING_CALLOUT_RE = /^\s*(<div data-callout[^>]*>[\s\S]*?<\/div>)\s*/;

/**
 * Replace the report body's LEADING Next Steps callout (per the report
 * contract it is the first body block, above `## TL;DR`) with `callout`.
 * When the body has no leading callout, prepend one — the normalizer
 * enforces the single-callout-first invariant either way.
 */
export function replaceLeadingCallout(body, callout) {
  const m = String(body).match(LEADING_CALLOUT_RE);
  if (m) {
    return `${callout}\n\n${body.slice(m[0].length)}`;
  }
  return `${callout}\n\n${body.replace(/^\n+/, "")}`;
}

function makeSectionSpec({ modeId, modeFile, title, stageLabel, timeoutMs = 600000 }) {
  return {
    modeId,
    timeoutMs,

    async loadInputs(ctx) {
      const offer = findOfferRow(ctx.rootPath, ctx.num);
      if (!offer) throw new Error(`offer #${ctx.num} not found in data/applications.md`);
      const shared = readFileSync(join(ctx.rootPath, "content/modes/_shared.md"), "utf-8");
      const modeBody = stripFrontMatter(
        readFileSync(join(ctx.rootPath, `content/modes/${modeFile}`), "utf-8"),
      );
      const reportRaw = readFileSync(join(ctx.rootPath, offer.reportPath), "utf-8");
      const report = parseReportFile(reportRaw);
      return { offer, shared, modeBody, report };
    },

    buildPrompt(ctx, { offer, shared, modeBody, report }) {
      return `You are running the sur9e "${modeId}" mode (${stageLabel}) headlessly.
Research with your CLI's web-search / web-fetch capability as the mode
describes. Your ONLY deliverable is ONE markdown H2 section, emitted between
the sentinels, starting with the exact heading "## ${title}":

<<<SUR9E_OUTPUT>>>
## ${title}

…section markdown…
<<<SUR9E_END>>>

EXCEPTION — Next Steps refresh: if your findings change the report's
recommended action, you may place ONE updated Next Steps callout
(<div data-callout data-variant="…" data-emoji="…">**Next Steps** …</div>)
ABOVE the "## ${title}" heading inside the sentinels; the app replaces the
report's leading callout with it. If the recommendation is unchanged, emit
only the section.

Nothing after the closing sentinel. Do NOT edit any file — the app inserts
the section (and the callout, when present) into the report for you.
Research happens on the WEB only; all local inputs (report, CV, profile) are already inlined below — do NOT search the filesystem, other projects, logs, or transcripts. Do NOT
re-emit the report frontmatter or any other section.

==================== MODE CONTRACT (content/modes/${modeFile}) ====================
${modeBody}

==================== SHARED REPORT CONTRACT ====================
${shared}

==================== OFFER ====================
- Offer #: ${offer.num}
- Company: ${offer.company}
- Role: ${offer.role}
- URL: ${offer.url ?? "(none on file)"}

==================== CURRENT REPORT (context — do not re-emit) ====================
${report.body}`;
    },

    parse(stdout) {
      let payload = extractSentinelPayload(stdout);
      // Optional leading Next Steps callout (above the section heading) —
      // split it off so the section itself still starts with the H2.
      let callout = null;
      const cm = payload.match(LEADING_CALLOUT_RE);
      if (cm) {
        // Normalize to the blank-line-padded form: markdown inside an HTML
        // block only renders when the contents are separated from the tags
        // by blank lines — a single-line callout shows literal ** in the
        // editor (caught in browser verification).
        const inner = cm[1].match(/^<div([^>]*)>([\s\S]*?)<\/div>$/);
        callout = inner
          ? `<div${inner[1]}>\n\n${inner[2].trim()}\n\n</div>`
          : cm[1];
        payload = payload.slice(cm[0].length);
      }
      const headingLine = `## ${title}`;
      const firstLine = payload.split("\n").find((l) => l.trim() !== "") ?? "";
      if (firstLine.trim() !== headingLine) {
        throw new Error(
          `section payload must start with "${headingLine}" (got "${firstLine.trim().slice(0, 60)}")`,
        );
      }
      return { section: payload, callout };
    },

    async write(ctx, { offer }, { section, callout }) {
      const reportAbs = join(ctx.rootPath, offer.reportPath);
      const { frontmatter, body } = parseReportFile(readFileSync(reportAbs, "utf-8"));
      let nextBody = upsertSection(body, title, section);
      if (callout) {
        nextBody = replaceLeadingCallout(nextBody, callout);
      }
      writeFileSync(reportAbs, serializeReportFile(frontmatter, nextBody), "utf-8");
      const calloutNote = callout ? ", Next Steps callout refreshed" : "";
      return {
        summary: `${stageLabel} appended to ${offer.reportPath} (## ${title}${calloutNote})`,
      };
    },
  };
}

export const researchSpec = makeSectionSpec({
  modeId: "research",
  modeFile: "research.md",
  title: "Company Research",
  stageLabel: "company research",
});

export const interviewPrepSpec = makeSectionSpec({
  modeId: "interview-prep",
  modeFile: "interview-prep.md",
  title: "Interview Process",
  stageLabel: "interview process intel",
});

export const outreachSpec = makeSectionSpec({
  modeId: "reach-out",
  modeFile: "reach-out.md",
  title: "Outreach",
  stageLabel: "outreach research",
  // Heaviest section mode: persona searches × 3 + one verification fetch
  // per candidate contact + message drafting. 10 min was measured too
  // tight on claude-sonnet (smoke timed out at 600s).
  timeoutMs: 1200000,
});

export const negotiateSpec = makeSectionSpec({
  modeId: "negotiate",
  modeFile: "negotiate.md",
  title: "Negotiation Strategy",
  stageLabel: "negotiation strategy",
});
