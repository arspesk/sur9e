import { describe, expect, it } from 'vitest';
import { extractFallbackStamp } from '../runner';

describe('extractFallbackStamp', () => {
  it('parses the last [FALLBACK] marker from job output', () => {
    const output = [
      'some log',
      '[FALLBACK] {"from":{"provider":"claude","model":"claude-opus-4-7"},"to":{"provider":"codex","model":"gpt-5-codex"},"reason":"overloaded"}',
      'more output',
    ].join('\n');
    expect(extractFallbackStamp(output)).toEqual({
      from: { provider: 'claude', model: 'claude-opus-4-7' },
      to: { provider: 'codex', model: 'gpt-5-codex' },
      reason: 'overloaded',
    });
  });
  it('returns null when no marker present', () => {
    expect(extractFallbackStamp('just logs')).toBeNull();
  });
  it('returns null on malformed marker JSON', () => {
    expect(extractFallbackStamp('[FALLBACK] {not json')).toBeNull();
  });
  it('takes the LAST marker when several exist (multi-call jobs like screen)', () => {
    const output = [
      '[FALLBACK] {"from":{"provider":"claude","model":"a"},"to":{"provider":"codex","model":"b"},"reason":"quota"}',
      '[FALLBACK] {"from":{"provider":"claude","model":"a"},"to":{"provider":"opencode","model":"c"},"reason":"overloaded"}',
    ].join('\n');
    expect(extractFallbackStamp(output)?.to.provider).toBe('opencode');
  });
});
