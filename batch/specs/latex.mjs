import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { jdBlock, readOptional } from "../lib/inputs.mjs";
import { resolveOfferSource } from "../lib/offer-source.mjs";
import { findOfferRow, markOfferPdf } from "../lib/offers.mjs";
import { extractSentinelPayload } from "../lib/output-parser.mjs";
import { stripFrontMatter } from "../lib/report-file.mjs";
import { companySlug, kebabName } from "../lib/slug.mjs";

function defaultCompile(texPath, pdfPath, rootPath) {
  execFileSync("node", ["cli/generate-latex.mjs", texPath, pdfPath], {
    cwd: rootPath,
    stdio: "inherit",
  });
}

export const latexSpec = {
  modeId: "latex",
  timeoutMs: 600000,

  async loadInputs(ctx) {
    const offer = findOfferRow(ctx.rootPath, ctx.num);
    if (!offer) throw new Error(`offer #${ctx.num} not found in data/applications.md`);
    const cv = readFileSync(join(ctx.rootPath, "inputs/personalization/cv.md"), "utf-8");
    const profileRaw = readFileSync(
      join(ctx.rootPath, "inputs/personalization/profile.yml"),
      "utf-8",
    );
    const profile = yaml.load(profileRaw) || {};
    const narrative = readOptional(join(ctx.rootPath, "inputs/personalization/narrative.md"));
    const modeBody = stripFrontMatter(
      readFileSync(join(ctx.rootPath, "content/modes/latex.md"), "utf-8"),
    );
    const template = readFileSync(
      join(ctx.rootPath, "content/templates/cv-template.tex"),
      "utf-8",
    );
    const source = await resolveOfferSource(ctx.rootPath, offer);
    return {
      offer,
      cv,
      profileRaw,
      profile,
      narrative,
      modeBody,
      template,
      source,
      jd: source.jd,
    };
  },

  buildPrompt(ctx, { offer, cv, profileRaw, narrative, modeBody, template, source, jd }) {
    return `You are running the sur9e "latex" mode headlessly.
Generate the complete final LaTeX CV. You have no file or shell tools; the app
writes and compiles the document.

OUTPUT FORMAT:
- Output exactly one block bounded by <<<SUR9E_OUTPUT>>> and <<<SUR9E_END>>>.
- Inside the block output only the complete LaTeX document, beginning with
  \\documentclass and ending with \\end{document}.
- Do not use markdown fences or commentary.

==================== MODE CONTRACT ====================
${modeBody}

==================== LATEX TEMPLATE ====================
${template}

==================== CANDIDATE CV ====================
${cv}

==================== CANDIDATE PROFILE ====================
${profileRaw}
${narrative ? `\n==================== CANDIDATE NARRATIVE ====================\n${narrative}\n` : ""}
==================== OFFER ====================
- Offer #: ${offer.num}
- Company: ${offer.company}
- Role: ${offer.role}
- Source: ${source.label}

==================== JOB DESCRIPTION ====================
${jdBlock(jd)}`;
  },

  parse(stdout) {
    const tex = extractSentinelPayload(stdout, {
      recover: { startRe: /^\\documentclass\b/ },
    }).trim();
    if (!tex.startsWith("\\documentclass") || !tex.includes("\\begin{document}")) {
      throw new Error("payload does not contain a complete LaTeX document");
    }
    if (!tex.includes("\\end{document}")) {
      throw new Error("LaTeX document is missing \\end{document}");
    }
    return tex;
  },

  async write(ctx, { offer, profile }, tex, { compile = defaultCompile } = {}) {
    const candidate = kebabName(profile?.candidate?.full_name || profile?.name || "candidate");
    const slug = companySlug(offer.company);
    const today = new Date().toISOString().slice(0, 10);
    const base = `cv-latex-${candidate}-${slug}-${ctx.num}-${today}`;
    const texPath = join(ctx.rootPath, `artifacts/output/${base}.tex`);
    const pdfPath = join(ctx.rootPath, `artifacts/output/${base}.pdf`);
    mkdirSync(join(ctx.rootPath, "artifacts/output"), { recursive: true });
    writeFileSync(texPath, tex, "utf-8");
    compile(texPath, pdfPath, ctx.rootPath);
    if (!existsSync(pdfPath)) throw new Error("LaTeX compiler produced no PDF");
    markOfferPdf(ctx.rootPath, ctx.num);
    return {
      summary: `LaTeX CV written: artifacts/output/${base}.tex and artifacts/output/${base}.pdf`,
    };
  },
};
