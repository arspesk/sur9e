#!/usr/bin/env node
// Stop hook — when Claude finishes a turn, attribute the new assistant
// messages' tokens to the active /sur9e <mode> invocation (or 'session'
// if no mode is active) and call trackClaude. State file tracks the
// last-processed assistant uuid per session so subsequent fires don't
// double-count.
//
// Bypass: set CLAUDE_SKIP_HOOK=1 to disable (e.g. during debugging).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { canonicalMode, KNOWN_MODES } from '../../cli/lib/mode-detect.mjs';

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HOOK_DIR, '..', '..');
const STATE_PATH = join(ROOT, 'data', 'usage-mode-state.json');

if (process.env.CLAUDE_SKIP_HOOK === '1') process.exit(0);

let raw = '';
try {
  raw = await new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      buf += chunk;
    });
    process.stdin.on('end', () => resolve(buf));
    setTimeout(() => resolve(buf), 200);
  });
} catch {
  process.exit(0);
}
if (!raw.trim()) process.exit(0);

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const sessionId = payload.session_id;
const transcriptPath = payload.transcript_path;
if (!sessionId || !transcriptPath || !existsSync(transcriptPath)) process.exit(0);

let state = {};
if (existsSync(STATE_PATH)) {
  try {
    state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {}
}
const sessionState = state[sessionId] || { lastUuid: null, currentMode: null };

let lines;
try {
  lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n');
} catch {
  process.exit(0);
}

const transcript = [];
for (const line of lines) {
  try {
    transcript.push(JSON.parse(line));
  } catch {
    /* skip malformed */
  }
}

let startIdx = 0;
if (sessionState.lastUuid) {
  for (let i = 0; i < transcript.length; i++) {
    if (transcript[i].uuid === sessionState.lastUuid) {
      startIdx = i + 1;
      break;
    }
  }
}

// KNOWN_MODES, MODE_ALIAS, and canonicalMode now live in
// cli/lib/mode-detect.mjs — shared with the OpenCode plugin and Codex hook so
// the mode list can't drift across the three agents' trackers.

function detectMode(content) {
  // Only accept the structured slash-command wrapper Claude Code emits when
  // the user actually types /sur9e <args>. Loose bare-text matching pulls in
  // false positives from skill documentation (the sur9e router doc mentions
  // /sur9e pipeline, /sur9e scan, etc.) that gets injected as a system
  // reminder on every turn.
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map(b => (b && typeof b === 'object' && b.type === 'text' ? b.text || '' : ''))
            .join(' ')
        : '';
  const cmdMatch = text.match(
    /<command-name>\/?sur9e<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>/,
  );
  if (!cmdMatch) return null;
  const argsStr = (cmdMatch[1] || '').trim();
  if (!argsStr) return 'discovery';
  const first = argsStr.split(/\s+/)[0]?.toLowerCase();
  if (first && KNOWN_MODES.has(first)) {
    return first === 'interview' ? 'interview-prep' : first;
  }
  return 'evaluate-offer';
}

// Mode is only "active" for the assistant work directly responding to a
// /sur9e <mode> message. The next REAL user message (not tool_result, not
// system reminder injection) clears the mode unless it's another /sur9e.
// This avoids tagging hours of follow-up debugging as 'evaluate' when the
// user only ran one /sur9e at the start of the session.
function isToolResultMessage(content) {
  if (!Array.isArray(content)) return false;
  return content.some(b => b && typeof b === 'object' && b.type === 'tool_result');
}

let activeMode = sessionState.currentMode; // carried across hook fires
const usageByMode = {};
let lastUuid = sessionState.lastUuid;

for (let i = startIdx; i < transcript.length; i++) {
  const entry = transcript[i];
  if (entry.uuid) lastUuid = entry.uuid;
  const m = entry.message;
  if (!m || typeof m !== 'object') continue;

  if (m.role === 'user' && !entry.isSidechain && !isToolResultMessage(m.content)) {
    // Real user-typed message. Either starts a new /sur9e mode or clears
    // the previous one (any non-/sur9e prompt ends the mode's lifetime).
    activeMode = detectMode(m.content);
  }

  if (m.role === 'assistant' && m.usage) {
    const mode = canonicalMode(activeMode);
    if (!mode) continue; // no active /sur9e mode → general conversation, don't track
    const model = m.model || 'claude-sonnet-4-6';
    const bucket =
      usageByMode[mode] ||
      (usageByMode[mode] = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        modelCounts: {},
      });
    bucket.input_tokens += m.usage.input_tokens || 0;
    bucket.output_tokens += m.usage.output_tokens || 0;
    bucket.cache_creation_input_tokens += m.usage.cache_creation_input_tokens || 0;
    bucket.cache_read_input_tokens += m.usage.cache_read_input_tokens || 0;
    bucket.modelCounts[model] = (bucket.modelCounts[model] || 0) + 1;
  }
}

if (Object.keys(usageByMode).length > 0) {
  const { trackClaude, computeCostFromUsage } = await import(join(ROOT, 'cli/usage-tracker.mjs'));
  for (const [mode, u] of Object.entries(usageByMode)) {
    // Pick the most-used model in this batch as the rate basis.
    const model = Object.entries(u.modelCounts).sort((a, b) => b[1] - a[1])[0][0];
    const cost = computeCostFromUsage(u, model);
    if (cost <= 0) continue;
    trackClaude(
      u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
      u.output_tokens,
      { cost_usd: cost, model, mode },
    );
  }
}

state[sessionId] = { lastUuid, currentMode: activeMode };
if (!existsSync(dirname(STATE_PATH))) mkdirSync(dirname(STATE_PATH), { recursive: true });
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
