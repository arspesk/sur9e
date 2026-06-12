// test/mode-runner-usage.test.mjs
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackModeUsage } from '../batch/lib/usage.mjs';

describe('trackModeUsage', () => {
  it('tracks tiktoken-estimated tokens into the provider bucket of usage.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-test-'));
    trackModeUsage(
      { provider: 'codex', model: 'gpt-5.5' },
      'evaluate',
      'four words of prompt',
      'two outputs',
      { rootPath: root },
    );
    const data = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = Object.keys(data)[0];
    const bucket = data[month].codex;
    expect(bucket.calls).toBe(1);
    expect(bucket.input_tokens).toBeGreaterThan(0);
    expect(bucket.output_tokens).toBeGreaterThan(0);
  });
});

describe('antigravity input cap', () => {
  it('caps agy input estimation at the measured ~48K-char truncation ceiling', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-agy-'));
    const bigPrompt = 'word '.repeat(60000); // 300K chars
    trackModeUsage(
      { provider: 'antigravity', model: 'claude-sonnet-4.6-thinking' },
      'evaluate',
      bigPrompt,
      'short response',
      { rootPath: root },
    );
    const data = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const bucket = data[Object.keys(data)[0]].antigravity;
    // 48K chars of 'word ' ≈ 9.6K tokens — way under the 60K of the full prompt
    expect(bucket.input_tokens).toBeLessThan(15000);
    expect(bucket.input_tokens).toBeGreaterThan(5000);
  });

  it('does not cap other providers', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-claude-'));
    const bigPrompt = 'word '.repeat(60000);
    trackModeUsage({ provider: 'claude', model: 'claude-sonnet-4-6' }, 'evaluate', bigPrompt, 'r', {
      rootPath: root,
    });
    const data = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const bucket = data[Object.keys(data)[0]].claude;
    expect(bucket.input_tokens).toBeGreaterThan(50000);
  });
});
