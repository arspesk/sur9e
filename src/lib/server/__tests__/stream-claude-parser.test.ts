// src/lib/server/__tests__/stream-claude-parser.test.ts
//
// Parse-boundary tests for the typed stream-claude-parser surface.
// Three layers:
//   1. UsageEvent.parse on a hand-built payload
//   2. parseUsageMarker(line) — string → UsageEvent | null helper
//   3. End-to-end: spawn the .mjs parser with NDJSON on stdin, find
//      the [USAGE] line, run it through extractLastUsageMarker
//
// Layer 3 mirrors the production flow: stream-claude-parser.mjs reads
// stdin and prints [USAGE] {…} on a successful `result` event; jobs.mjs
// scans the spawned job's stdout for that marker and forwards into
// trackClaude(...). extractLastUsageMarker performs the same scan.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The schema file is the typed surface for the .mjs CLI's output.
import { extractLastUsageMarker, parseUsageMarker, UsageEvent } from '../../schemas/usage-events';

const PARSER_MJS = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../cli',
  'stream-claude-parser.mjs',
);

describe('UsageEvent schema', () => {
  it('parses a full payload', () => {
    const ev = UsageEvent.parse({
      cost_usd: 0.42,
      input_tokens: 1500,
      output_tokens: 250,
      model: 'claude-sonnet-4-6',
    });
    expect(ev.cost_usd).toBe(0.42);
    expect(ev.input_tokens).toBe(1500);
    expect(ev.output_tokens).toBe(250);
    expect(ev.model).toBe('claude-sonnet-4-6');
  });

  it('accepts nulls (the parser emits these when result.usage is partial)', () => {
    const ev = UsageEvent.parse({
      cost_usd: null,
      input_tokens: null,
      output_tokens: null,
      model: null,
    });
    expect(ev.cost_usd).toBeNull();
    expect(ev.model).toBeNull();
  });

  it('rejects non-numeric cost_usd', () => {
    expect(() =>
      UsageEvent.parse({
        cost_usd: 'cheap',
        input_tokens: 0,
        output_tokens: 0,
        model: 'x',
      }),
    ).toThrow();
  });
});

describe('parseUsageMarker', () => {
  it('returns the parsed event for a well-formed [USAGE] line', () => {
    const ev = parseUsageMarker(
      '[USAGE] {"cost_usd":0.42,"input_tokens":1500,"output_tokens":250,"model":"claude-sonnet-4-6"}',
    );
    expect(ev).not.toBeNull();
    expect(ev?.cost_usd).toBe(0.42);
    expect(ev?.model).toBe('claude-sonnet-4-6');
  });

  it('returns null for a non-marker line', () => {
    expect(parseUsageMarker('some other output')).toBeNull();
    expect(parseUsageMarker('')).toBeNull();
  });

  it('returns null for a marker with malformed JSON', () => {
    expect(parseUsageMarker('[USAGE] not-json{')).toBeNull();
  });

  it('returns null when the payload fails schema validation', () => {
    expect(parseUsageMarker('[USAGE] {"cost_usd":"oops"}')).toBeNull();
  });
});

describe('extractLastUsageMarker', () => {
  it('returns the last [USAGE] line when multiple are present', () => {
    const output = [
      'step 1',
      '[USAGE] {"cost_usd":0.10,"input_tokens":100,"output_tokens":50,"model":"a"}',
      'step 2',
      '[USAGE] {"cost_usd":0.42,"input_tokens":1500,"output_tokens":250,"model":"b"}',
      'step 3',
    ].join('\n');
    const ev = extractLastUsageMarker(output);
    expect(ev?.cost_usd).toBe(0.42);
    expect(ev?.model).toBe('b');
  });

  it('returns null when no marker is present', () => {
    expect(extractLastUsageMarker('plain stdout')).toBeNull();
    expect(extractLastUsageMarker('')).toBeNull();
    expect(extractLastUsageMarker(null)).toBeNull();
  });
});

describe('stream-claude-parser end-to-end', () => {
  it('emits a [USAGE] marker on result event that parses through UsageEvent', async () => {
    const ndjsonInput = [
      '{"type":"system","subtype":"init","session_id":"abc","model":"claude-sonnet-4-6"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"duration_ms":12000,"num_turns":3,"total_cost_usd":0.42,"usage":{"input_tokens":1500,"output_tokens":250},"model":"claude-sonnet-4-6"}',
    ].join('\n');

    const out: string = await new Promise((resolve, reject) => {
      const child = spawn('node', [PARSER_MJS], { stdio: ['pipe', 'pipe', 'inherit'] });
      let buf = '';
      child.stdout.on('data', d => {
        buf += d.toString();
      });
      child.on('exit', () => resolve(buf));
      child.on('error', reject);
      child.stdin.write(ndjsonInput);
      child.stdin.end();
    });

    const ev = extractLastUsageMarker(out);
    expect(ev).not.toBeNull();
    expect(ev?.cost_usd).toBe(0.42);
    expect(ev?.input_tokens).toBe(1500);
    expect(ev?.output_tokens).toBe(250);
    expect(ev?.model).toBe('claude-sonnet-4-6');
  }, 10000);
});
