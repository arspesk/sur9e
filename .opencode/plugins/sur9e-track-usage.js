// SPDX-License-Identifier: MIT
// .opencode/plugins/sur9e-track-usage.js
//
// OpenCode plugin — mirrors the Claude Code Stop hook
// (.claude/hooks/track-mode-usage.mjs): on each COMPLETED assistant turn it
// attributes that turn's interactive token spend to the active /sur9e <mode>
// invocation (or the literal label 'session' when no mode is active) and calls
// trackProvider('opencode', ...). A per-session active mode is tracked the same
// way the Claude hook does it: a mode is only "live" for the turn(s) answering a
// `/sur9e <mode>` message; the next real user message clears it.
//
// Dedup: each completed assistant message id is counted exactly once, guarded by
// an in-memory Set AND a persisted state file (data/usage-mode-opencode-state.json)
// so an OpenCode restart mid-session doesn't double-count.
//
// Auto-loads from .opencode/plugins/ — no opencode.json entry needed.
// Bypass: set SUR9E_SKIP_USAGE_HOOK=1 to disable (e.g. during debugging).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalMode, detectModeFromText } from '../../cli/lib/mode-detect.mjs';

// .opencode/plugins/ → up two dirs is the repo root.
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(PLUGIN_DIR, '..', '..');
const STATE_PATH = join(ROOT, 'data', 'usage-mode-opencode-state.json');

/**
 * Pure token/cost extraction for a completed OpenCode assistant message.
 * Exported so the math can be unit-tested without an OpenCode runtime.
 *
 * `input`  = tokens.input + tokens.cache.read + tokens.cache.write
 * `output` = tokens.output + tokens.reasoning
 *
 * `countable` is false for anything that isn't a finished assistant turn, or
 * for an empty turn (cost 0 AND every token bucket 0) — those would add a noisy
 * zero-cost call to the tracker.
 *
 * @param {any} info — the Message from a message.updated event (properties.info)
 * @returns {{ input: number, output: number, model: string, cost: number, estimated: boolean, countable: boolean }}
 */
export function opencodeUsageFromMessage(info) {
  if (!info || info.role !== 'assistant' || !info.time || typeof info.time.completed !== 'number') {
    return { input: 0, output: 0, model: '', cost: 0, estimated: false, countable: false };
  }

  const tokens = info.tokens || {};
  const cache = tokens.cache || {};
  const input = (tokens.input || 0) + (cache.read || 0) + (cache.write || 0);
  const output = (tokens.output || 0) + (tokens.reasoning || 0);
  const cost = typeof info.cost === 'number' ? info.cost : 0;
  const model = info.modelID || '';

  // Skip empty turns: no spend and no tokens means there's nothing to attribute.
  const countable = cost !== 0 || input !== 0 || output !== 0;

  return { input, output, model, cost, estimated: false, countable };
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
  try {
    if (!existsSync(dirname(STATE_PATH))) mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    /* best-effort; never break the session over a state write */
  }
}

export const Sur9eTrackUsage = async () => {
  if (process.env.SUR9E_SKIP_USAGE_HOOK === '1') return {};

  // In-memory dedup guard (fast path) layered over the persisted watermark.
  const countedIds = new Set();
  // sessionID → true: message ids we've learned belong to USER messages, so a
  // following message.part.updated text part can be routed to mode detection.
  const userMessageIds = new Set();

  const state = loadState();

  function sessionEntry(sessionId) {
    if (!state[sessionId]) state[sessionId] = { countedIds: [], currentMode: null };
    if (!Array.isArray(state[sessionId].countedIds)) state[sessionId].countedIds = [];
    for (const id of state[sessionId].countedIds) countedIds.add(id);
    return state[sessionId];
  }

  // A user text part either starts a new /sur9e mode or, being any other real
  // user message, clears the previous one — mirroring the Claude hook lifecycle.
  function applyUserText(sessionId, text) {
    const entry = sessionEntry(sessionId);
    entry.currentMode = detectModeFromText(text); // null for non-/sur9e prompts
    saveState(state);
  }

  function recordCompletedTurn(info) {
    const sessionId = info.sessionID;
    if (!sessionId || !info.id) return;
    if (countedIds.has(info.id)) return;

    const usage = opencodeUsageFromMessage(info);
    if (!usage.countable) return;

    const entry = sessionEntry(sessionId);

    // Mark counted (both layers) before tracking so a throw can't cause a
    // re-count on the next event.
    countedIds.add(info.id);
    entry.countedIds.push(info.id);
    saveState(state);

    const mode = canonicalMode(entry.currentMode) ?? 'session';
    trackProvider('opencode', usage.input, usage.output, {
      model: usage.model,
      mode,
      cost_usd: usage.cost,
      estimated: false,
      rootPath: ROOT,
    });
  }

  // Dynamic import keeps the tracker out of the module-eval path (so a missing
  // tracker can't stop the plugin from loading) and matches the Claude hook.
  let trackProviderImpl = null;
  async function trackProvider(...args) {
    if (!trackProviderImpl) {
      ({ trackProvider: trackProviderImpl } = await import(join(ROOT, 'cli/usage-tracker.mjs')));
    }
    return trackProviderImpl(...args);
  }

  return {
    event: async ({ event }) => {
      try {
        if (!event || typeof event.type !== 'string') return;

        if (event.type === 'message.updated') {
          const info = event.properties?.info;
          if (!info) return;
          if (info.role === 'user' && info.id) {
            userMessageIds.add(info.id);
            return;
          }
          if (info.role === 'assistant') {
            recordCompletedTurn(info);
          }
          return;
        }

        if (event.type === 'message.part.updated') {
          // User text arrives as TextParts, not on the user message envelope, so
          // mode detection has to read it here. Only route real (non-synthetic,
          // non-ignored) text parts that belong to a known user message.
          const part = event.properties?.part;
          if (!part || part.type !== 'text') return;
          if (part.synthetic || part.ignored) return;
          if (!part.messageID || !userMessageIds.has(part.messageID)) return;
          if (typeof part.text !== 'string' || !part.text) return;
          applyUserText(part.sessionID, part.text);
        }
      } catch {
        // Never throw out of the hook — a tracking failure must not break the
        // user's OpenCode session.
      }
    },
  };
};

export default Sur9eTrackUsage;
