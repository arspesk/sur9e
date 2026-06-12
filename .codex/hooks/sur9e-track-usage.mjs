#!/usr/bin/env node
// Codex Stop hook — when a Codex turn completes, attribute that turn's
// interactive token spend to the active /sur9e <mode> invocation (or 'session'
// when no mode is active) and call trackProvider('codex', ...). Mirrors the
// Claude Code Stop hook at .claude/hooks/track-mode-usage.mjs.
//
// Codex's Stop payload does NOT carry token usage — only session metadata. The
// usage lives in the session ROLLOUT file
// (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl), where JSONL `event_msg`
// entries with payload.type === "token_count" carry the CUMULATIVE
// `info.total_token_usage`. This hook computes the per-turn delta against the
// previous cumulative it persisted for the session (state file keyed by
// session_id) and tracks only that delta.
//
// Bypass: set SUR9E_SKIP_USAGE_HOOK=1 to disable (e.g. during debugging).
//
// IMPORTANT (Codex caveat): hooks declared in a repo-local .codex/config.toml
// do NOT fire in interactive sessions (openai/codex#17532). Register this hook
// in the USER-LEVEL ~/.codex/config.toml via `node .codex/install-hook.mjs`.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalMode, detectModeFromText } from '../../cli/lib/mode-detect.mjs';
import { trackProvider } from '../../cli/usage-tracker.mjs';

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
// .codex/hooks/ → repo root is two dirs up.
const ROOT = join(HOOK_DIR, '..', '..');
const STATE_PATH = join(ROOT, 'data', 'usage-mode-codex-state.json');

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests — importing this module must NOT run the
// hook body, which is guarded behind the isMain() check at the bottom).
// ---------------------------------------------------------------------------

// Parse rollout JSONL text → ordered array of cumulative TokenUsage totals.
// Each token_count event_msg carries info.total_token_usage (cumulative for
// the whole session). We collect them in file order; the last one is the
// session's latest cumulative.
export function parseTokenCounts(jsonlText) {
  const out = [];
  if (typeof jsonlText !== 'string') return out;
  for (const line of jsonlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!entry || entry.type !== 'event_msg') continue;
    const payload = entry.payload;
    if (!payload || payload.type !== 'token_count') continue;
    const total = payload.info?.total_token_usage;
    if (!total || typeof total !== 'object') continue;
    out.push({
      input_tokens: Number(total.input_tokens) || 0,
      cached_input_tokens: Number(total.cached_input_tokens) || 0,
      output_tokens: Number(total.output_tokens) || 0,
      reasoning_output_tokens: Number(total.reasoning_output_tokens) || 0,
      total_tokens: Number(total.total_tokens) || 0,
    });
  }
  return out;
}

const ZERO_USAGE = {
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: 0,
};

// Per-turn usage = latest cumulative − previous cumulative. First turn (prev
// null/undefined) → latest as-is. Negative deltas (session reset / resumed
// rollout) clamp to 0.
export function turnDelta(prev, latest) {
  if (!latest || typeof latest !== 'object') return { ...ZERO_USAGE };
  const base = prev && typeof prev === 'object' ? prev : ZERO_USAGE;
  const delta = {};
  for (const key of Object.keys(ZERO_USAGE)) {
    delta[key] = Math.max(0, (Number(latest[key]) || 0) - (Number(base[key]) || 0));
  }
  return delta;
}

// Find the text of the latest real USER message in a parsed rollout. Codex
// persists user turns as response_item / message / role:"user" lines whose
// content is an array of { type: "input_text", text }. Returns '' when none.
export function latestUserText(rolloutEntries) {
  if (!Array.isArray(rolloutEntries)) return '';
  for (let i = rolloutEntries.length - 1; i >= 0; i--) {
    const entry = rolloutEntries[i];
    if (!entry || entry.type !== 'response_item') continue;
    const payload = entry.payload;
    if (!payload || payload.type !== 'message' || payload.role !== 'user') continue;
    const content = payload.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .map(c => (c && typeof c === 'object' && typeof c.text === 'string' ? c.text : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  return '';
}

// Parse rollout JSONL into an array of entries ({ type, payload, ... }),
// skipping malformed lines.
export function parseRolloutEntries(jsonlText) {
  const out = [];
  if (typeof jsonlText !== 'string') return out;
  for (const line of jsonlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

// Pull the active model slug from a parsed rollout: prefer the latest
// turn_context.model, fall back to the latest token_count info model fields if
// present. Returns null when nothing usable is found (caller falls back to the
// Stop payload's model).
export function modelFromRollout(rolloutEntries) {
  if (!Array.isArray(rolloutEntries)) return null;
  for (let i = rolloutEntries.length - 1; i >= 0; i--) {
    const entry = rolloutEntries[i];
    if (entry && entry.type === 'turn_context' && entry.payload?.model) {
      return entry.payload.model;
    }
  }
  return null;
}

// Resolve the rollout file for this Stop event. Prefer the payload's
// transcript_path; otherwise scan ~/.codex/sessions for the newest
// rollout-*.jsonl whose filename embeds the session_id (Codex names files
// rollout-<timestamp>-<uuid>.jsonl).
export function resolveRolloutPath({ transcriptPath, sessionId, codexHome }) {
  if (transcriptPath && existsSync(transcriptPath)) return transcriptPath;
  if (!sessionId) return null;
  const sessionsDir = join(codexHome || join(homedir(), '.codex'), 'sessions');
  if (!existsSync(sessionsDir)) return null;
  let best = null;
  const walk = dir => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (
        ent.isFile() &&
        ent.name.startsWith('rollout-') &&
        ent.name.endsWith('.jsonl') &&
        ent.name.includes(sessionId)
      ) {
        let mtime = 0;
        try {
          mtime = statSync(full).mtimeMs;
        } catch {
          continue;
        }
        if (!best || mtime > best.mtime) best = { path: full, mtime };
      }
    }
  };
  walk(sessionsDir);
  return best ? best.path : null;
}

// Read stdin to a string, resolving early on a short timeout so a Codex turn is
// never blocked by a stuck pipe.
function readStdin() {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      buf += chunk;
    });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
    setTimeout(() => resolve(buf), 200);
  });
}

function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  if (!existsSync(dirname(STATE_PATH))) mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Hook body
// ---------------------------------------------------------------------------

async function main() {
  if (process.env.SUR9E_SKIP_USAGE_HOOK === '1') return;

  let raw;
  try {
    raw = await readStdin();
  } catch {
    return;
  }
  if (!raw || !raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const sessionId = payload.session_id;
  if (!sessionId) return;

  const rolloutPath = resolveRolloutPath({
    transcriptPath: payload.transcript_path,
    sessionId,
    codexHome: process.env.CODEX_HOME,
  });
  if (!rolloutPath || !existsSync(rolloutPath)) return;

  let jsonlText;
  try {
    jsonlText = readFileSync(rolloutPath, 'utf-8');
  } catch {
    return;
  }

  const cumulatives = parseTokenCounts(jsonlText);
  if (cumulatives.length === 0) return;
  const latest = cumulatives[cumulatives.length - 1];

  const state = loadState();
  const sessionState = state[sessionId] || { cumulative: null, currentMode: null };

  const delta = turnDelta(sessionState.cumulative, latest);
  const input = delta.input_tokens; // includes cached input tokens
  const output = delta.output_tokens + delta.reasoning_output_tokens;

  // Mode lifecycle: a /sur9e invocation in the latest user message updates the
  // session's mode; otherwise we keep the prior mode (mirrors the Claude hook).
  const entries = parseRolloutEntries(jsonlText);
  const detected = detectModeFromText(latestUserText(entries));
  const activeMode = detected !== null ? detected : sessionState.currentMode;

  // Persist the new cumulative + mode regardless of whether we tracked spend,
  // so the next turn's delta is computed against this turn's cumulative.
  state[sessionId] = { cumulative: latest, currentMode: activeMode };
  saveState(state);

  if (input === 0 && output === 0) return;

  const model = payload.model || modelFromRollout(entries) || undefined;
  const mode = canonicalMode(activeMode) ?? 'session';

  trackProvider('codex', input, output, { model, mode, estimated: false, rootPath: ROOT });
}

// Run only when invoked directly as the hook command, never on import (tests
// import the pure helpers above).
function isMain() {
  if (!process.argv[1]) return false;
  try {
    // Compare via realpath so a symlinked invocation path (e.g. macOS
    // /var → /private/var) still matches this module's resolved location.
    const self = realpathSync(fileURLToPath(import.meta.url));
    const invoked = realpathSync(process.argv[1]);
    return self === invoked;
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch(() => {
    // Never break the user's turn on a tracking failure.
    process.exit(0);
  });
}
