// batch/lib/report-file.mjs
//
// Minimal frontmatter-report file operations for the .mjs batch layer.
// Mirrors the format produced by src/lib/server/reports.ts (server-only,
// unimportable here): `---\n<yaml>\n---\n\n<markdown body>`. Keep these dumb:
// schema validation lives in the mode specs, markdown healing lives in the
// post-job normalizer (runner.ts -> normalizeFinishedReport).

import yaml from "js-yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseReportFile(raw) {
  const m = String(raw || "").match(FRONTMATTER_RE);
  if (!m) throw new Error("report file has no frontmatter block");
  const frontmatter = yaml.load(m[1]);
  if (!frontmatter || typeof frontmatter !== "object") {
    throw new Error("report frontmatter did not parse to an object");
  }
  return { frontmatter, body: m[2] };
}

export function serializeReportFile(frontmatter, body) {
  const fmText = yaml.dump(frontmatter, { lineWidth: -1 }).trimEnd();
  // padCallouts at the serializer choke point (idempotent): every writer
  // gets the blank-line-padded callout form, so no call site can forget
  // and re-introduce the literal-asterisk rendering bug.
  return `---\n${fmText}\n---\n\n${padCallouts(body.replace(/^\n+/, ""))}`;
}

/**
 * Strip a leading YAML front-matter block (the mode-manifest header) from a
 * mode file's text, returning just the prompt body. Mode manifests are
 * loader metadata — they must never reach the model, and a prompt that
 * STARTS with `---` breaks argv parsing in provider CLIs (claude treats a
 * leading dash as an option: `error: unknown option '---…'`). Returns the
 * text unchanged when there is no front-matter.
 */
export function stripFrontMatter(text) {
  const m = String(text || "").match(FRONTMATTER_RE);
  return m ? m[2].replace(/^\n+/, "") : String(text || "");
}

/**
 * Blank-line-pad every `<div data-callout …>` block in a markdown body.
 * Markdown inside an HTML block only renders when separated from the tags
 * by blank lines; models (codex especially) emit callouts single-line,
 * which shows literal ** asterisks in the editor. Idempotent — already
 * padded callouts round-trip unchanged.
 */
export function padCallouts(markdown) {
  return String(markdown || "").replace(
    /<div data-callout([^>]*)>\s*([\s\S]*?)\s*<\/div>/g,
    (_, attrs, inner) => `<div data-callout${attrs}>\n\n${inner}\n\n</div>`,
  );
}

/**
 * Extract a named set of H2 sections from a report body, preserving the
 * caller-specified ORDER (not file order). Used by evaluate.write() to
 * rescue mode-owned sections (Company Research, Interview Process, etc.)
 * before overwriting the file with a fresh model-emitted body.
 *
 * Each returned object has:
 *   { title: string, sectionMarkdown: string }
 * where `sectionMarkdown` is the full section INCLUDING its `## title`
 * heading line (same shape upsertSection expects).
 *
 * Titles not found in `body` are silently omitted from the result, so the
 * caller can safely iterate without branching on "does it exist?".
 *
 * Section boundary logic mirrors upsertSection exactly: a section runs
 * from its `## Title` heading through the line before the next `## `
 * heading (or EOF).
 */
export function extractNamedSections(body, titles) {
  const lines = String(body).split("\n");
  const result = [];
  for (const title of titles) {
    const headingLine = `## ${title}`;
    const start = lines.findIndex((l) => l.trim() === headingLine);
    if (start === -1) continue; // section not present — skip
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) {
        end = i;
        break;
      }
    }
    result.push({
      title,
      sectionMarkdown: lines.slice(start, end).join("\n").replace(/\n+$/, ""),
    });
  }
  return result;
}

/**
 * Insert or replace one H2 section in a report body. `title` is the bare
 * heading text (e.g. 'Company Research'); `sectionMarkdown` is the full
 * section INCLUDING its `## title` heading. An existing section with the
 * same exact title is replaced from its heading up to (not including) the
 * next `## ` heading or EOF; otherwise the section is appended at the end.
 */
export function upsertSection(body, title, sectionMarkdown) {
  const lines = String(body).split("\n");
  const headingLine = `## ${title}`;
  const start = lines.findIndex((l) => l.trim() === headingLine);
  const block = sectionMarkdown.replace(/\n+$/, "");
  if (start === -1) {
    return `${body.replace(/\n+$/, "")}\n\n${block}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start).join("\n").replace(/\n+$/, "");
  const after = lines.slice(end).join("\n").replace(/^\n+/, "");
  return after ? `${before}\n\n${block}\n\n${after}` : `${before}\n\n${block}\n`;
}
