import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  latestUserText,
  modelFromRollout,
  parseRolloutEntries,
  parseTokenCounts,
  turnDelta,
} from '../.codex/hooks/sur9e-track-usage.mjs';
import { alreadyInstalled, buildHookBlock, planConfig } from '../.codex/install-hook.mjs';
import { trackProvider } from '../cli/usage-tracker.mjs';

// Sample rollout JSONL mirroring the real Codex format: SessionMeta line,
// turn_context, user message, then a cumulative token_count, a second user
// turn and a second (larger) cumulative token_count.
const SAMPLE_ROLLOUT = [
  JSON.stringify({
    timestamp: '2026-06-07T10:00:00.000Z',
    type: 'session_meta',
    payload: { id: 'sess-abc', cwd: '/tmp' },
  }),
  JSON.stringify({
    timestamp: '2026-06-07T10:00:01.000Z',
    type: 'turn_context',
    payload: { turn_id: 't1', cwd: '/tmp', model: 'gpt-5' },
  }),
  JSON.stringify({
    timestamp: '2026-06-07T10:00:02.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '/sur9e evaluate https://jobs.example.com/1' }],
    },
  }),
  JSON.stringify({
    timestamp: '2026-06-07T10:00:05.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 1000,
          cached_input_tokens: 200,
          output_tokens: 300,
          reasoning_output_tokens: 50,
          total_tokens: 1350,
        },
        last_token_usage: {
          input_tokens: 1000,
          cached_input_tokens: 200,
          output_tokens: 300,
          reasoning_output_tokens: 50,
          total_tokens: 1350,
        },
        model_context_window: 272000,
      },
      rate_limits: null,
    },
  }),
  JSON.stringify({
    timestamp: '2026-06-07T10:01:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'thanks, anything else worth noting?' }],
    },
  }),
  JSON.stringify({
    timestamp: '2026-06-07T10:01:05.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 2500,
          cached_input_tokens: 800,
          output_tokens: 700,
          reasoning_output_tokens: 120,
          total_tokens: 3320,
        },
        last_token_usage: {},
        model_context_window: 272000,
      },
      rate_limits: null,
    },
  }),
].join('\n');

describe('parseTokenCounts', () => {
  it('extracts cumulative total_token_usage in file order', () => {
    const totals = parseTokenCounts(SAMPLE_ROLLOUT);
    expect(totals).toHaveLength(2);
    expect(totals[0]).toEqual({
      input_tokens: 1000,
      cached_input_tokens: 200,
      output_tokens: 300,
      reasoning_output_tokens: 50,
      total_tokens: 1350,
    });
    expect(totals[1].input_tokens).toBe(2500);
    expect(totals[1].output_tokens).toBe(700);
  });

  it('ignores malformed lines and non-token_count events', () => {
    const text = [
      'not json at all',
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'hi' } }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 42, output_tokens: 7 } },
        },
      }),
    ].join('\n');
    const totals = parseTokenCounts(text);
    expect(totals).toHaveLength(1);
    expect(totals[0].input_tokens).toBe(42);
    expect(totals[0].output_tokens).toBe(7);
    // Missing fields default to 0.
    expect(totals[0].reasoning_output_tokens).toBe(0);
  });

  it('returns [] for non-string / empty input', () => {
    expect(parseTokenCounts(null)).toEqual([]);
    expect(parseTokenCounts('')).toEqual([]);
  });
});

describe('turnDelta', () => {
  it('returns the full cumulative on the first turn (prev null)', () => {
    const latest = {
      input_tokens: 1000,
      cached_input_tokens: 200,
      output_tokens: 300,
      reasoning_output_tokens: 50,
      total_tokens: 1350,
    };
    expect(turnDelta(null, latest)).toEqual(latest);
  });

  it('subtracts the previous cumulative for subsequent turns', () => {
    const prev = { input_tokens: 1000, output_tokens: 300, reasoning_output_tokens: 50 };
    const latest = { input_tokens: 2500, output_tokens: 700, reasoning_output_tokens: 120 };
    const delta = turnDelta(prev, latest);
    expect(delta.input_tokens).toBe(1500);
    expect(delta.output_tokens).toBe(400);
    expect(delta.reasoning_output_tokens).toBe(70);
  });

  it('clamps negative deltas to 0 (session reset / resumed rollout)', () => {
    const prev = { input_tokens: 5000, output_tokens: 2000, reasoning_output_tokens: 100 };
    const latest = { input_tokens: 1000, output_tokens: 300, reasoning_output_tokens: 0 };
    const delta = turnDelta(prev, latest);
    expect(delta.input_tokens).toBe(0);
    expect(delta.output_tokens).toBe(0);
    expect(delta.reasoning_output_tokens).toBe(0);
  });
});

describe('latestUserText + mode detection', () => {
  it('returns the latest real user message text', () => {
    const entries = parseRolloutEntries(SAMPLE_ROLLOUT);
    expect(latestUserText(entries)).toBe('thanks, anything else worth noting?');
  });

  it('feeds detectModeFromText: a /sur9e turn resolves the mode', () => {
    const firstTurn = parseRolloutEntries(
      [
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '/sur9e evaluate https://x/1' }],
          },
        }),
      ].join('\n'),
    );
    expect(latestUserText(firstTurn)).toBe('/sur9e evaluate https://x/1');
  });

  it('returns "" when there is no user message', () => {
    const entries = parseRolloutEntries(
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5' } }),
    );
    expect(latestUserText(entries)).toBe('');
    expect(latestUserText(null)).toBe('');
  });
});

describe('modelFromRollout', () => {
  it('pulls the latest turn_context model', () => {
    const entries = parseRolloutEntries(SAMPLE_ROLLOUT);
    expect(modelFromRollout(entries)).toBe('gpt-5');
  });

  it('returns null when no turn_context carries a model', () => {
    expect(modelFromRollout([])).toBeNull();
    expect(modelFromRollout(null)).toBeNull();
  });
});

describe('trackProvider integration (temp rootPath, never real data/)', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sur9e-codex-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('writes a codex bucket priced from gpt-5 rates into temp usage.json', () => {
    // gpt-5: input 2.5, output 10.0 per 1M tokens.
    const input = 1000;
    const output = 350; // output + reasoning, as the hook computes it
    const result = trackProvider('codex', input, output, {
      model: 'gpt-5',
      mode: 'evaluate',
      estimated: false,
      rootPath: tmpRoot,
    });

    const expectedCost = (input / 1e6) * 2.5 + (output / 1e6) * 10.0;
    expect(result.cost_usd).toBeCloseTo(expectedCost, 6);

    const usage = JSON.parse(readFileSync(join(tmpRoot, 'data', 'usage.json'), 'utf-8'));
    const monthBucket = usage[result.month];
    expect(monthBucket).toBeTruthy();
    const codex = monthBucket.codex;
    expect(codex.calls).toBe(1);
    expect(codex.input_tokens).toBe(input);
    expect(codex.output_tokens).toBe(output);
    expect(codex.by_model['gpt-5']).toBeTruthy();
    expect(codex.by_mode.evaluate).toBeTruthy();
    expect(codex.estimated_calls).toBe(0);
  });

  it('persists cost 0 for an unknown codex model (never fabricates)', () => {
    const result = trackProvider('codex', 1000, 200, {
      model: 'gpt-9-unreleased',
      mode: 'session',
      rootPath: tmpRoot,
    });
    expect(result.cost_usd).toBe(0);
  });
});

describe('install-hook config planning (temp file, never real ~/.codex)', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sur9e-codex-cfg-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('appends a [[hooks.Stop]] block when absent', () => {
    const cmd = '/abs/path/.codex/hooks/sur9e-track-usage.mjs';
    const { changed, text } = planConfig('', cmd);
    expect(changed).toBe(true);
    expect(text).toContain('[[hooks.Stop]]');
    expect(text).toContain('[[hooks.Stop.hooks]]');
    expect(text).toContain('type = "command"');
    expect(text).toContain(cmd);
  });

  it('is idempotent: a second plan over the produced text is a no-op', () => {
    const cmd = '/abs/path/.codex/hooks/sur9e-track-usage.mjs';
    const first = planConfig('', cmd);
    expect(alreadyInstalled(first.text, cmd)).toBe(true);
    const second = planConfig(first.text, cmd);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });

  it('preserves existing unrelated config when appending', () => {
    const cmd = '/abs/path/hook.mjs';
    const existing = 'model = "gpt-5"\n[mcp_servers.foo]\ncommand = "bar"\n';
    const { changed, text } = planConfig(existing, cmd);
    expect(changed).toBe(true);
    expect(text.startsWith(existing)).toBe(true);
    expect(text).toContain('[[hooks.Stop]]');
  });

  it('actually writes to a temp config file, not the real one', () => {
    const cmd = '/abs/path/hook.mjs';
    const cfgPath = join(tmpRoot, 'config.toml');
    const { text } = planConfig(null, cmd);
    writeFileSync(cfgPath, text);
    const round = readFileSync(cfgPath, 'utf-8');
    expect(round).toContain('[[hooks.Stop]]');
    expect(buildHookBlock(cmd)).toContain('command = "/abs/path/hook.mjs"');
  });
});
