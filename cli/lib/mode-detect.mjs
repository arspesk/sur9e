// SPDX-License-Identifier: MIT
// cli/lib/mode-detect.mjs
//
// Shared sur9e mode-detection + aliasing for the per-agent spend-tracking
// hooks (Claude Code Stop hook, OpenCode plugin, Codex Stop/notify hook). The
// goal is one source of truth for the mode list + aliases so the three hooks
// can't drift. Each hook handles its own transcript format and calls
// trackProvider()/trackClaude() with the mode this module resolves.

// Current /sur9e <mode> names, plus the still-recognized legacy aliases that
// predate the mode renames (auto-pipeline → evaluate-offer, pipeline →
// process-queue). The older one-word legacy names (offer/deep/contact/pdf/
// followup) are intentionally absent: only names listed here bucket token
// cost; anything else falls through to evaluate-offer.
export const KNOWN_MODES = new Set([
  'evaluate',
  'offers',
  'reach-out',
  'research',
  'tailor-cv',
  'training',
  'project',
  'tracker',
  'process-queue',
  'pipeline', // legacy alias for process-queue
  'apply',
  'scan',
  'batch',
  'patterns',
  'follow-up',
  'interview-prep',
  'interview',
  'latex',
  'screen',
  'evaluate-offer',
  'auto-pipeline', // legacy alias for evaluate-offer
]);

// Orchestration modes get aliased to the underlying mode that actually spends
// the tokens (evaluate-offer runs an evaluation; scan/batch/process-queue run
// screens). The pre-rename names (auto-pipeline, pipeline) map to the same
// buckets so historical usage data and older saved commands keep resolving.
// Aliases resolving to null are dropped entirely (no API work).
export const MODE_ALIAS = {
  'evaluate-offer': 'evaluate',
  'auto-pipeline': 'evaluate',
  scan: 'screen',
  batch: 'screen',
  'process-queue': 'screen',
  pipeline: 'screen',
  discovery: null,
};

// Resolve an alias to the bucket that owns the spend. Returns null for modes
// that shouldn't be tracked (e.g. 'discovery') or a null/empty input.
export function canonicalMode(mode) {
  if (!mode) return null;
  if (Object.prototype.hasOwnProperty.call(MODE_ALIAS, mode)) return MODE_ALIAS[mode];
  return mode;
}

// Map a bare first-arg token to a tracked mode (the only special case is
// interview → interview-prep). Returns 'evaluate-offer' for an unrecognized arg
// (a pasted JD/URL routes through the full evaluation) and null when there's no
// arg.
function modeFromArg(argsStr) {
  const trimmed = (argsStr || '').trim();
  if (!trimmed) return 'discovery';
  const first = trimmed.split(/\s+/)[0]?.toLowerCase();
  if (first && KNOWN_MODES.has(first)) return first === 'interview' ? 'interview-prep' : first;
  return 'evaluate-offer';
}

// Detect the active sur9e mode from a plain user-message string (OpenCode /
// Codex transcripts, which have no structured slash-command wrapper). Matches
// only an explicit `/sur9e <args>` invocation so router-doc text that merely
// mentions "/sur9e pipeline" doesn't produce false positives. Returns the
// tracked mode name, 'discovery' for a bare `/sur9e`, or null when the message
// isn't a sur9e invocation (caller treats null as "no active mode").
export function detectModeFromText(text) {
  const str = typeof text === 'string' ? text : '';
  // Require /sur9e at a word boundary, then capture the rest of that line.
  const m = str.match(/(?:^|\s)\/sur9e(?:[ \t]+([^\n]*))?(?:\n|$)/);
  if (!m) return null;
  return modeFromArg(m[1] || '');
}
