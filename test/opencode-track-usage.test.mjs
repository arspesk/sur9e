import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { opencodeUsageFromMessage } from '../.opencode/plugins/sur9e-track-usage.js';
import { trackProvider } from '../cli/usage-tracker.mjs';

function assistantMessage(over = {}) {
  return {
    id: 'msg_1',
    sessionID: 'ses_1',
    role: 'assistant',
    modelID: 'anthropic/claude-3-haiku',
    providerID: 'anthropic',
    mode: 'build',
    time: { created: 1, completed: 2 },
    cost: 0.0123,
    tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
    ...over,
  };
}

describe('opencodeUsageFromMessage', () => {
  it('sums cache read + write into input', () => {
    const u = opencodeUsageFromMessage(assistantMessage());
    expect(u.input).toBe(100 + 20 + 5);
    expect(u.countable).toBe(true);
  });

  it('folds reasoning tokens into output', () => {
    const u = opencodeUsageFromMessage(assistantMessage());
    expect(u.output).toBe(50 + 10);
  });

  it('passes through model and cost, never estimated', () => {
    const u = opencodeUsageFromMessage(assistantMessage());
    expect(u.model).toBe('anthropic/claude-3-haiku');
    expect(u.cost).toBe(0.0123);
    expect(u.estimated).toBe(false);
  });

  it('tolerates missing token sub-objects', () => {
    const u = opencodeUsageFromMessage(
      assistantMessage({ cost: 0.5, tokens: { input: 7, output: 3 } }),
    );
    expect(u.input).toBe(7);
    expect(u.output).toBe(3);
    expect(u.countable).toBe(true);
  });

  it('is not countable for an all-zero, no-cost turn', () => {
    const u = opencodeUsageFromMessage(
      assistantMessage({
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    );
    expect(u.countable).toBe(false);
  });

  it('counts a zero-token turn that still has a cost', () => {
    const u = opencodeUsageFromMessage(
      assistantMessage({
        cost: 0.01,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    );
    expect(u.countable).toBe(true);
  });

  it('is not countable for a user message', () => {
    const u = opencodeUsageFromMessage({ role: 'user', id: 'u1', time: { created: 1 } });
    expect(u.countable).toBe(false);
  });

  it('is not countable for an incomplete assistant turn (no time.completed)', () => {
    const u = opencodeUsageFromMessage(assistantMessage({ time: { created: 1 } }));
    expect(u.countable).toBe(false);
  });

  it('is not countable for null / malformed input', () => {
    expect(opencodeUsageFromMessage(null).countable).toBe(false);
    expect(opencodeUsageFromMessage(undefined).countable).toBe(false);
    expect(opencodeUsageFromMessage({}).countable).toBe(false);
  });
});

describe('trackProvider integration (temp rootPath, never the real data dir)', () => {
  it('writes an opencode bucket with the verbatim cost_usd', () => {
    const root = mkdtempSync(join(tmpdir(), 'sur9e-opencode-usage-'));
    const u = opencodeUsageFromMessage(assistantMessage());

    const res = trackProvider('opencode', u.input, u.output, {
      model: u.model,
      mode: 'evaluate',
      cost_usd: u.cost,
      estimated: false,
      rootPath: root,
    });

    expect(res.cost_usd).toBe(0.0123);

    const data = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const bucket = data[res.month].opencode;
    expect(bucket).toBeDefined();
    expect(bucket.calls).toBe(1);
    expect(bucket.input_tokens).toBe(u.input);
    expect(bucket.output_tokens).toBe(u.output);
    expect(bucket.cost_usd).toBe(0.0123);
    expect(bucket.by_model['anthropic/claude-3-haiku']).toBeDefined();
    expect(bucket.by_mode.evaluate.calls).toBe(1);
  });
});
