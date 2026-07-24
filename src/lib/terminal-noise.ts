// src/lib/terminal-noise.ts
//
// Framework-neutral sanitizers for worker/CLI output that leaks into a UI
// surface. Shared by BOTH sides of the job pipeline:
//   - the server runner (src/lib/server/jobs/runner.ts) — cleans streamed
//     output before it is persisted to data/jobs/<id>.json, and extracts a
//     human failure cause for the failed-job card;
//   - the chat jobs strip's log view (src/features/chat/chat-jobs-lib.ts) —
//     a second line of defense so a stale/legacy record never renders raw
//     ANSI escapes, `<<<SUR9E_*>>>` sentinels, or HTML error-page tails.
//
// No Node or React imports — safe to pull into a server-only module AND a
// client component. The regexes mirror batch/lib/output-parser.mjs's
// stripTerminalNoise (kept a copy rather than importing that module so this
// stays dependency-free and usable in the browser bundle).

// Terminal pollution some provider CLIs interleave with their output: CSI
// color/format codes (`ESC[0m`), OSC sequences (`ESC]777;…BEL`), and
// ESC-stripped `[0m`-style remnants after a lossy pipe.
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const BARE_OSC_RE = /\][0-9]{1,4};[^\x07\n]*(?:\x07|(?=\n)|$)/g;

/** Strip ANSI/OSC terminal escape noise from a string. Mirror of
 * batch/lib/output-parser.mjs's stripTerminalNoise. */
export function stripTerminalNoise(text: string): string {
  return String(text ?? '')
    .replace(ANSI_OSC_RE, '')
    .replace(ANSI_CSI_RE, '')
    .replace(BARE_OSC_RE, '')
    .replace(/\[[0-9;]{1,6}m/g, ''); // ESC-stripped CSI remnants like "[0m"
}

// The worker's stdout carries the deliverable inside a
// `<<<SUR9E_OUTPUT>>> … <<<SUR9E_END>>>` envelope; a failed run can leak whole
// or partial markers into the persisted output. Scrub the tokens so they never
// reach a subtitle or log line.
const SENTINEL_TOKEN_RE = /<<<SUR9E_[A-Z_]*>>>/g;

/**
 * Scrub a single failure line for display as the failed-job card subtitle:
 * strip terminal noise, replace any leaked `<<<SUR9E_*>>>` sentinel tokens
 * with a neutral word (so "no <<<SUR9E_OUTPUT>>> sentinel…" reads "no output
 * sentinel…"), collapse whitespace, and cap to a subtitle-sized length. The
 * full text always stays in the captured logs.
 */
export function cleanErrorLine(text: string, max = 200): string {
  const scrubbed = stripTerminalNoise(text)
    .replace(SENTINEL_TOKEN_RE, 'output')
    .replace(/\s+/g, ' ')
    .trim();
  if (scrubbed.length <= max) return scrubbed;
  return `${scrubbed.slice(0, max - 1)}…`;
}

// A line that mentions a sentinel token anywhere (whole or partial) — noise in
// a progress log. Broader than SENTINEL_TOKEN_RE so a truncated marker still
// gets dropped from the log view.
const SENTINEL_LINE_RE = /<<<SUR9E_/;
// A raw HTML markup line — a failed fetch (e.g. a 404 page) tails raw HTML into
// the stream. A log line that opens with an HTML tag is page noise, never mode
// progress (mode-runner status lines start with a letter, `✅`/`❌`/`⚠️`, or
// `[USAGE]`/`[FALLBACK]`). `<<<`-sentinel lines don't match this (2nd char is
// `<`, not a letter) — they're handled by SENTINEL_LINE_RE.
const HTML_TAG_LINE_RE = /^<\/?[a-z!]/i;

/**
 * Turn raw job output into clean log lines for the strip's log pane: strip
 * terminal noise, then drop blank lines, leaked sentinel lines, and raw
 * HTML-page tail lines. Keeps only the last `max` lines.
 */
export function sanitizeJobLogLines(output: string, max = 200): string[] {
  if (!output) return [];
  return stripTerminalNoise(output)
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (SENTINEL_LINE_RE.test(t)) return false;
      if (HTML_TAG_LINE_RE.test(t)) return false;
      return true;
    })
    .slice(-max);
}
