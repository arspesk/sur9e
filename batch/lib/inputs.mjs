// batch/lib/inputs.mjs
//
// Tiny input helpers shared by the mode specs (evaluate / pdf / sections):
// optional-file reads and the inlined-JD block with the __JD_INCOMPLETE__
// marker contract from batch/jd-fetcher.mjs.

import { existsSync, readFileSync } from "node:fs";

export function readOptional(path) {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

/**
 * Render a jd-fetcher result ({ text, status, error? }) as the prompt block.
 * Incomplete/error pages carry the __JD_INCOMPLETE__ marker so the model
 * scores low-confidence instead of fabricating.
 */
export function jdBlock(jd) {
  if (jd.status === "ok") return jd.text;
  if (jd.status === "incomplete") {
    return `${jd.text}\n\n__JD_INCOMPLETE__ (fetched only ${jd.text.length} chars; likely SPA/consent wall)`;
  }
  return `${jd.text || ""}\n\n__JD_INCOMPLETE__ (fetch failed: ${jd.error ?? "unknown"})`;
}
