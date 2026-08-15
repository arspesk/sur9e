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

// A line that is nothing but a markdown code-fence marker: ``` / ```html /
// ~~~yaml, optionally indented, nothing else on the line. Used to unwrap a
// deliverable a model wrapped in a fence.
const FENCE_LINE_RE = /^\s*(?:`{3,}|~{3,})[a-zA-Z0-9-]*\s*$/;

// Unwrap a code fence that spans the ENTIRE payload (first non-blank line is a
// fence opener AND last non-blank line is a fence closer). A payload that only
// CONTAINS an interior fence, or does not both open and close with one, is
// returned untouched — so `---`-frontmatter reports and `## `-heading sections
// keep their bodies verbatim. Never unwraps to nothing. Safe for every mode:
// no real deliverable is a single top-to-bottom fenced block.
function stripWrappingFence(payload) {
  const lines = payload.split("\n");
  let first = 0;
  while (first < lines.length && lines[first].trim() === "") first++;
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") last--;
  if (first >= last) return payload; // 0 or 1 content line — nothing wrapping
  if (!FENCE_LINE_RE.test(lines[first]) || !FENCE_LINE_RE.test(lines[last])) return payload;
  const inner = lines
    .slice(first + 1, last)
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
  return inner.trim() ? inner : payload;
}

// Lenient recovery for document modes whose deliverable has a recognizable
// opening line (pdf: `format: letter|a4`). Invoked ONLY when no strict sentinel
// pair exists, and ONLY when a caller opts in via `recover.startRe` — so
// evaluate/sections stay strict and model chatter can never leak into their
// payloads. Handles two real misformats captured from opencode/big-pickle:
//   • the closing END emitted but the opening OUTPUT line dropped, and
//   • no sentinels at all with the deliverable buried under a "**Note:**"
//     preamble and wrapped in markdown fences.
// Returns the recovered body, or null when the deliverable start cannot be
// confidently located (caller then throws the normal missing-sentinel error).
function recoverPayload(lines, startRe) {
  // Anchor on the deliverable's first line; this drops any preamble/commentary
  // the model emitted before it.
  const startIdx = lines.findIndex((l) => startRe.test(l.trim()));
  if (startIdx === -1) return null;
  // Stop at a line-anchored END sentinel if the model emitted one (it did in
  // attempt 2); otherwise take the remainder of the response.
  let endIdx = lines.findIndex((l, j) => j > startIdx && l.trim() === END_MARK);
  if (endIdx === -1) endIdx = lines.length;
  // Drop lone code-fence marker lines. A model sometimes fences the deliverable
  // (in one or several blocks); the HTML/text deliverable never legitimately
  // contains a bare ``` line, so removing them within this recovery path is
  // safe and reassembles the raw document.
  const body = lines
    .slice(startIdx, endIdx)
    .filter((l) => !FENCE_LINE_RE.test(l))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
  return body.trim() ? body : null;
}

// Extract a sentinel-delimited payload.
//
// Happy path (unchanged): both sentinels present on their own lines → return
// the last well-formed pair's payload (with any full-payload fence unwrapped).
//
// options.recover.startRe — opt-in lenient recovery for document modes. When
// no strict pair is found and this is supplied, recover the deliverable by
// anchoring on its opening line. Omit it (evaluate/sections) to keep strict
// behavior: a missing/malformed pair throws.
export function extractSentinelPayload(responseText, options = {}) {
  const recoverStartRe = options.recover?.startRe;
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
        // Some models wrap the whole payload in a ```-fence even inside the
        // sentinels; unwrap it so the deliverable is the raw document.
        if (payload.trim()) return stripWrappingFence(payload);
      }
      if (start === -1) start = i;
    }
  }
  // Strict pair absent. Opt-in recovery for lenient document modes only.
  if (recoverStartRe) {
    const recovered = recoverPayload(lines, recoverStartRe);
    if (recovered) return recovered;
  }
  if (start === -1) throw new Error(`no ${OUTPUT_MARK} sentinel in response`);
  throw new Error(`no ${END_MARK} sentinel after ${OUTPUT_MARK} (or payload empty)`);
}

// Stream-formatter trailer lines cli/stream-claude-parser.mjs emits AFTER the
// model's final text on a successful claude-routed run: the human status line
// ("✓ claude done — 1 turns, $0.02, 41s") and the structured usage marker
// ("[USAGE] {…}"). They land in captured stdout because the claude spawn is
// piped through that formatter (see buildSpawnArgsForMode), so a trailing-
// fence contract can never match end-of-string on those runs (issue #91).
const FORMATTER_TRAILER_RE = /^(?:✓ \S+ done — .*|\[USAGE\] .*)$/;

// Drop formatter trailers (and blank lines) from the END of the text only —
// identical-looking content INSIDE the model's payload is untouched, and a
// trailer line anywhere before the final fence is irrelevant to matching.
export function stripFormatterTrailers(text) {
  const lines = String(text ?? "").split("\n");
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1].trim();
    if (line !== "" && !FORMATTER_TRAILER_RE.test(line)) break;
    end--;
  }
  return lines.slice(0, end).join("\n");
}

export function extractTrailingFence(responseText) {
  const text = stripFormatterTrailers(stripTerminalNoise(responseText));
  // Deliberately end-anchored (after trailer stripping) rather than "last
  // fence anywhere": if the model echoes a fenced profile/JD from the prompt
  // but never emits the contract block, matching an arbitrary earlier fence
  // would record junk fields as a real screen. Throwing here keeps that case
  // a loud "unreadable" instead.
  const fenceRe = /```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/;
  const m = text.match(fenceRe);
  if (!m) throw new Error("no trailing fenced block in response");
  const parsed = yaml.load(m[1]);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("trailing fenced block did not yield an object");
  }
  return parsed;
}
