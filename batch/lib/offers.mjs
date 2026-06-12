// batch/lib/offers.mjs
//
// Look up one tracker row from data/applications.md and resolve its report
// file + posting URL. Same parsing rules command-registry.ts used inline:
// pipe-split row, parts[1]=num, parts[3]=company, parts[4]=role, parts[8]
// holds the `[N](path)` report link. URL comes from the report frontmatter.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseReportFile } from "./report-file.mjs";

function containedPath(root, p) {
  const full = resolve(root, p);
  const rel = relative(root, full);
  if (rel.startsWith("..") || resolve(root, rel) !== full) return null;
  return full;
}

export function findOfferRow(rootPath, num) {
  const appsPath = join(rootPath, "data/applications.md");
  if (!existsSync(appsPath)) return null;
  for (const line of readFileSync(appsPath, "utf-8").split("\n")) {
    if (!line.startsWith("|")) continue;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 9) continue;
    if (parseInt(parts[1], 10) !== num) continue;
    const m = parts[8].match(/\[(\d+)\]\(([^)]+)\)/);
    if (!m) return null;
    const reportPath = m[2];
    const full = containedPath(rootPath, reportPath);
    if (!full || !existsSync(full)) return null;
    let url = null;
    try {
      const { frontmatter } = parseReportFile(readFileSync(full, "utf-8"));
      if (typeof frontmatter.url === "string" && frontmatter.url) url = frontmatter.url;
    } catch {
      return null;
    }
    return { num, company: parts[3], role: parts[4], reportPath, url };
  }
  return null;
}

// Flip the PDF cell (parts[7]) of one tracker row to ✅ after a tailored CV is
// generated — the executable twin of tailor-cv.md's post-generation step 1,
// which only the interactive agent used to perform. Returns true when the row
// was found (already-✅ rows count as success), false when no row matches num.
export function markOfferPdf(rootPath, num) {
  const appsPath = join(rootPath, "data/applications.md");
  if (!existsSync(appsPath)) return false;
  const lines = readFileSync(appsPath, "utf-8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) continue;
    const parts = lines[i].split("|");
    if (parts.length < 10) continue;
    if (parseInt(parts[1], 10) !== num) continue;
    if (parts[7].trim() === "✅") return true;
    parts[7] = " ✅ ";
    lines[i] = parts.join("|");
    writeFileSync(appsPath, lines.join("\n"), "utf-8");
    return true;
  }
  return false;
}
