// batch/lib/output-parser.mjs
//
// Output parsers for the portable mode contract. Two shapes:
//  - sentinel payloads (<<<SUR9E_OUTPUT>>> … <<<SUR9E_END>>>) for document
//    deliverables (full reports, H2 sections, HTML) that may themselves
//    contain fenced blocks / frontmatter dashes;
//  - trailing fenced blocks (```json … ```) for small structured results
//    (the screen contract — kept for compatibility).
// Both take the LAST occurrence so a model that echoes the contract text
// earlier in its response doesn't break parsing.

import yaml from "js-yaml";

const OUTPUT_MARK = "<<<SUR9E_OUTPUT>>>";
const END_MARK = "<<<SUR9E_END>>>";

// Terminal pollution some CLIs (opencode TUI renderer, agy) interleave with
// the model's text: CSI color/format codes (`ESC[0m`), bare `[0m`-style
// remnants after a lossy pipe, and OSC sequences (`ESC]777;notify;…BEL`).
// Strip them BEFORE sentinel/fence matching so a marker rendered mid-stream
// still matches exactly (caught in the provider matrix: opencode's plugin
// stream hid the sentinels from the parser).
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const BARE_OSC_RE = /\][0-9]{1,4};[^\x07\n]*(?:\x07|(?=\n)|$)/g;

export function stripTerminalNoise(text) {
  return String(text || "")
    .replace(ANSI_OSC_RE, "")
    .replace(ANSI_CSI_RE, "")
    .replace(BARE_OSC_RE, "")
    .replace(/\[[0-9;]{1,6}m/g, ""); // ESC-stripped CSI remnants like "[0m"
}

export function extractSentinelPayload(responseText) {
  const text = stripTerminalNoise(responseText);
  // LINE-ANCHORED matching: the contract puts each sentinel on its own
  // line. Models routinely MENTION the markers inline afterwards ("Report
  // emitted between `<<<SUR9E_OUTPUT>>>` / `<<<SUR9E_END>>>` sentinels —
  // …", caught live with deepseek), so a raw lastIndexOf grabs the prose
  // mention and yields a junk pair. Only lines that consist of exactly the
  // marker count; we take the LAST well-formed pair.
  const lines = text.split("\n");
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === OUTPUT_MARK) {
      // candidate opener — needs a line-anchored END after it
      const endIdx = lines.findIndex((l, j) => j > i && l.trim() === END_MARK);
      if (endIdx !== -1) {
        const payload = lines
          .slice(i + 1, endIdx)
          .join("\n")
          .replace(/^\n+/, "")
          .replace(/\n+$/, "");
        if (payload.trim()) return payload;
      }
      if (start === -1) start = i;
    }
  }
  if (start === -1) throw new Error(`no ${OUTPUT_MARK} sentinel in response`);
  throw new Error(`no ${END_MARK} sentinel after ${OUTPUT_MARK} (or payload empty)`);
}

export function extractTrailingFence(responseText) {
  const text = stripTerminalNoise(responseText);
  const fenceRe = /```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/;
  const m = text.match(fenceRe);
  if (!m) throw new Error("no trailing fenced block in response");
  const parsed = yaml.load(m[1]);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("trailing fenced block did not yield an object");
  }
  return parsed;
}
