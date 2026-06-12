// batch/specs/pdf.mjs
//
// PDF generator specs: tailor-cv and cover-letter. The model emits
// `format: letter|a4` on the first payload line then a complete HTML
// document; Node writes the HTML to /tmp and runs cli/generate-pdf.mjs.
// Output naming MUST match the Attachments glob:
//   artifacts/output/{cv|cover-letter}-{candidate}-{companySlug}-{num}-{date}.pdf
// The offer num keeps two offers at the same company from overwriting each
// other's artifacts (two Stripe roles on one day used to collide).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { fetchJobDescription } from "../jd-fetcher.mjs";
import { jdBlock, readOptional } from "../lib/inputs.mjs";
import { findOfferRow, markOfferPdf } from "../lib/offers.mjs";
import { extractSentinelPayload } from "../lib/output-parser.mjs";
import { stripFrontMatter } from "../lib/report-file.mjs";
import { companySlug, kebabName } from "../lib/slug.mjs";

function defaultPdfImpl(htmlPath, pdfPath, format, rootPath) {
  execFileSync("node", ["cli/generate-pdf.mjs", htmlPath, pdfPath, `--format=${format}`], {
    cwd: rootPath,
    stdio: "inherit",
  });
}

function makePdfSpec({ modeId, modeFile, templateFile, filePrefix, label }) {
  return {
    modeId,
    timeoutMs: 600000,

    async loadInputs(ctx) {
      const offer = findOfferRow(ctx.rootPath, ctx.num);
      if (!offer) throw new Error(`offer #${ctx.num} not found in data/applications.md`);
      if (!offer.url) throw new Error(`offer #${ctx.num} report has no url in frontmatter`);
      const cv = readFileSync(join(ctx.rootPath, "inputs/personalization/cv.md"), "utf-8");
      const profileRaw = readFileSync(
        join(ctx.rootPath, "inputs/personalization/profile.yml"),
        "utf-8",
      );
      const profile = yaml.load(profileRaw) || {};
      const narrative = readOptional(join(ctx.rootPath, "inputs/personalization/narrative.md"));
      const modeBody = stripFrontMatter(
        readFileSync(join(ctx.rootPath, `content/modes/${modeFile}`), "utf-8"),
      );
      const template = readFileSync(
        join(ctx.rootPath, `content/templates/${templateFile}`),
        "utf-8",
      );
      const jd = await fetchJobDescription(offer.url);
      return { offer, cv, profileRaw, profile, narrative, modeBody, template, jd };
    },

    buildPrompt(ctx, { offer, cv, profileRaw, narrative, modeBody, template, jd }) {
      const jdText = jdBlock(jd);
      return `You are running the sur9e "${modeId}" mode (${label}) headlessly.
Follow the mode contract below for CONTENT (keyword extraction, language,
paper format, ATS rules, template placeholders). You have NO file or shell
tools: do NOT write the HTML to disk and do NOT run generate-pdf.mjs — the
app does both.
ALL inputs are inlined below — do NOT search the filesystem, other projects, logs, or transcripts for inputs; do NOT read or write any file. Work only from this prompt. Your ONLY deliverable, between the sentinels:
line 1:  format: letter   (or  format: a4  — per the mode's location rule)
line 2+: the COMPLETE final HTML document (template with every {{…}}
         placeholder replaced).

<<<SUR9E_OUTPUT>>>
format: letter
<!DOCTYPE html>
…
<<<SUR9E_END>>>

==================== MODE CONTRACT (content/modes/${modeFile}) ====================
${modeBody}

==================== HTML TEMPLATE (content/templates/${templateFile}) ====================
${template}

==================== CANDIDATE CV ====================
${cv}

==================== CANDIDATE PROFILE (yaml) ====================
${profileRaw}
${narrative ? `\n==================== CANDIDATE NARRATIVE ====================\n${narrative}\n` : ""}
==================== OFFER ====================
- Offer #: ${offer.num}
- Company: ${offer.company}
- Role: ${offer.role}
- URL: ${offer.url}

==================== JOB DESCRIPTION (already fetched) ====================
${jdText}`;
    },

    parse(stdout) {
      const payload = extractSentinelPayload(stdout);
      const nl = payload.indexOf("\n");
      const first = (nl === -1 ? payload : payload.slice(0, nl)).trim();
      const m = first.match(/^format:\s*(letter|a4)$/);
      if (!m)
        throw new Error(
          `payload must start with "format: letter|a4" (got "${first.slice(0, 40)}")`,
        );
      const html = nl === -1 ? "" : payload.slice(nl + 1).trim();
      if (!/<html[\s>]/i.test(html)) throw new Error("payload does not contain an <html> document");
      return { format: m[1], html };
    },

    async write(ctx, { offer, profile }, { format, html }, { pdfImpl = defaultPdfImpl } = {}) {
      // Profile schema keeps the candidate's name at candidate.full_name
      // (legacy top-level `name` kept as fallback). Without the right key the
      // filename degrades to the literal 'candidate' and breaks the
      // Attachments naming convention.
      const candidate = kebabName(profile?.candidate?.full_name || profile?.name || "candidate");
      const slug = companySlug(offer.company);
      const today = new Date().toISOString().slice(0, 10);
      const htmlPath = join(tmpdir(), `${filePrefix}-${candidate}-${slug}.html`);
      const pdfPath = join(
        ctx.rootPath,
        `artifacts/output/${filePrefix}-${candidate}-${slug}-${ctx.num}-${today}.pdf`,
      );
      writeFileSync(htmlPath, html, "utf-8");
      try {
        pdfImpl(htmlPath, pdfPath, format, ctx.rootPath);
        if (!existsSync(pdfPath)) throw new Error("generate-pdf produced no file");
      } catch (err) {
        throw new Error(`pdf generation failed: ${err.message}`);
      } finally {
        try {
          unlinkSync(htmlPath);
        } catch {}
      }
      // tailor-cv.md post-generation step 1: the tracker's PDF cell flips to ✅
      // once a tailored CV exists. Only the cv prefix — the cover-letter PDF is
      // not what that column tracks. A missing row is reported, not thrown: the
      // PDF was generated, so the job must not flip to error over bookkeeping.
      let trackerNote = "";
      if (filePrefix === "cv") {
        trackerNote = markOfferPdf(ctx.rootPath, ctx.num)
          ? ", tracker PDF cell ✅"
          : ` — WARNING: tracker row #${ctx.num} not found, PDF cell not updated`;
      }
      return {
        summary: `${label} PDF written: artifacts/output/${filePrefix}-${candidate}-${slug}-${ctx.num}-${today}.pdf (${format})${trackerNote}`,
      };
    },
  };
}

export const tailorCvSpec = makePdfSpec({
  modeId: "tailor-cv",
  modeFile: "tailor-cv.md",
  templateFile: "cv-template.html",
  filePrefix: "cv",
  label: "tailored CV",
});

export const coverLetterSpec = makePdfSpec({
  modeId: "cover-letter",
  modeFile: "cover-letter.md",
  templateFile: "cover-letter-template.html",
  filePrefix: "cover-letter",
  label: "cover letter",
});
