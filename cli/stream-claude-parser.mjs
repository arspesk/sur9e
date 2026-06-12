#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * cli/stream-claude-parser.mjs
 *
 * Reads `claude --output-format stream-json --verbose -p ...` NDJSON from
 * stdin and emits human-readable progress lines to stdout. The cross-page
 * job pill shows our output as the eval's "logs" — without this, claude -p
 * buffers all output until completion (silent 5-10 minute middle gap).
 *
 * Event shapes we handle (subset of Claude Code's stream-json format):
 *   { type: 'system', subtype: 'init', session_id, ... }       → ignore
 *   { type: 'assistant', message: { content: [...] } }         → text deltas + tool announcements
 *   { type: 'user', message: { content: [tool_result] } }      → ignore (too verbose)
 *   { type: 'result', subtype: 'success', total_cost_usd, ... } → final summary
 *
 * Output is plain text (utf-8) suitable for the existing job-status-pill
 * body. The parent eval command pipes:
 *   claude --output-format stream-json --verbose -p "<prompt>" | node cli/stream-claude-parser.mjs
 *
 * Set `-o pipefail` in the parent script so a claude failure propagates
 * past the pipe and kills the chained merge-tracker step.
 */

import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin, terminal: false });

// Pretty-print one tool invocation as a single short line. Examples:
//   → WebFetch · https://www.linkedin.com/jobs/view/123
//   → Read · cv.md
//   → Bash · node merge-tracker.mjs --force
function describeTool(name, input) {
  if (!input || typeof input !== 'object') return '';
  if (name === 'WebFetch' && input.url) return input.url;
  if (name === 'WebSearch' && input.query) return input.query.slice(0, 80);
  if (
    (name === 'Read' || name === 'Edit' || name === 'Write' || name === 'NotebookEdit') &&
    input.file_path
  ) {
    // Show last segment + parent dir (e.g. "artifacts/reports/1272-pinterest-…md")
    const p = String(input.file_path);
    const idx = p.lastIndexOf('/');
    if (idx === -1) return p;
    const second = p.lastIndexOf('/', idx - 1);
    return second === -1 ? p : p.slice(second + 1);
  }
  if (name === 'Bash' && input.command)
    return String(input.command).replace(/\s+/g, ' ').slice(0, 100);
  if (name === 'Grep' && input.pattern) return `pattern: ${String(input.pattern).slice(0, 60)}`;
  if (name === 'Glob' && input.pattern) return input.pattern;
  // Fallback: first scalar value in the input object.
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length < 120) return v;
  }
  return '';
}

function fmtMoney(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  return `$${n.toFixed(2)}`;
}

function fmtDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

let lastWasText = false; // tracks whether we need a leading newline before the next non-text line
let sawResult = false; // a healthy stream always ends with a result event

function emit(line) {
  process.stdout.write(line);
}

rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    // Non-JSON line — pass through (rare; e.g. claude warning to stderr that got merged).
    emit(trimmed + '\n');
    lastWasText = false;
    return;
  }

  if (event.type === 'system') {
    // Init event — emit a one-liner so the user sees claude is alive.
    if (event.subtype === 'init') {
      emit(
        `▶ claude session ${String(event.session_id || '').slice(0, 8)} — model ${event.model || '?'}\n`,
      );
      lastWasText = false;
    }
    return;
  }

  if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
    for (const part of event.message.content) {
      if (part.type === 'text' && part.text) {
        emit(part.text);
        lastWasText = !part.text.endsWith('\n');
      } else if (part.type === 'tool_use') {
        if (lastWasText) emit('\n');
        const detail = describeTool(part.name, part.input);
        emit(`→ ${part.name}${detail ? ' · ' + detail : ''}\n`);
        lastWasText = false;
      } else if (part.type === 'thinking' && part.thinking) {
        // Claude's extended-thinking block — show a hint, not the raw thinking.
        if (lastWasText) emit('\n');
        emit(`💭 thinking…\n`);
        lastWasText = false;
      }
    }
    return;
  }

  // Tool results from {type:'user', message:{content:[{type:'tool_result',…}]}}
  // are intentionally ignored — they're huge (full WebFetch payloads etc.) and
  // would fill the job output buffer (256KB cap in jobs.mjs).
  if (event.type === 'user') return;

  if (event.type === 'result') {
    sawResult = true;
    if (lastWasText) emit('\n');
    if (
      event.is_error ||
      event.subtype === 'error_max_turns' ||
      event.subtype === 'error_during_execution'
    ) {
      emit(`✗ claude failed: ${event.error || event.subtype || 'unknown'}\n`);
      // Propagate the failure as OUR exit code. The spawn shape is
      // `claude ... | node stream-claude-parser.mjs` with no pipefail, so
      // the pipeline's status is THIS process's — without this, a claude
      // error (e.g. nonexistent --model) exits 0 and runModeLLM treats the
      // run as ok, skipping the fallback retry (caught in a live smoke).
      // exitCode (not exit()) so remaining lines still flush.
      process.exitCode = 1;
    } else {
      const cost = fmtMoney(event.total_cost_usd);
      const dur = fmtDuration(event.duration_ms);
      const turns = event.num_turns || '?';
      emit(`✓ claude done — ${turns} turns, ${cost}, ${dur}\n`);
      // Structured marker for the orchestrator (jobs.mjs) to parse and
      // forward into trackClaude({ ..., mode, cost_usd }).
      const payload = {
        cost_usd: event.total_cost_usd ?? null,
        input_tokens: event.usage?.input_tokens ?? null,
        output_tokens: event.usage?.output_tokens ?? null,
        model: event.model ?? null,
      };
      emit(`[USAGE] ${JSON.stringify(payload)}\n`);
    }
    lastWasText = false;
    return;
  }

  // Unknown event type — skip silently. Claude Code may add new event types
  // in future versions; we don't want to fill the pill body with NDJSON.
});

rl.on('close', () => {
  if (lastWasText) process.stdout.write('\n');
  // EOF without a result event means claude died mid-stream (OOM, SIGKILL,
  // crash). Same no-pipefail reasoning as the result-error path above: our
  // exit code IS the pipeline's, so propagate the failure.
  if (!sawResult) {
    process.stdout.write('✗ claude stream ended without result event\n');
    process.exitCode = 1;
  }
});

// Honor pipeline interruption (parent killed claude → SIGPIPE).
process.on('SIGPIPE', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
