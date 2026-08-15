// test/screen-parse-response.test.mjs
//
// parseScreenResponse must accept the screen contract's trailing fenced block
// even when provider-infrastructure noise surrounds it. Issue #91: a claude
// run (primary or opencode→claude fallback) is piped through
// cli/stream-claude-parser.mjs, so the captured stdout carries formatter
// trailer lines ("✓ claude done — …", "[USAGE] {…}") AFTER the model's fence —
// the old end-of-string regex rejected those responses as unreadable.
import { describe, expect, it } from 'vitest';
import { parseScreenResponse } from '../batch/screen.mjs';

describe('parseScreenResponse', () => {
  it('parses a plain trailing fenced JSON block', () => {
    const text = 'Assessment complete.\n```json\n{"readable": true, "score": 6.0}\n```\n';
    expect(parseScreenResponse(text)).toEqual({ readable: true, score: 6.0 });
  });

  it('parses the opencode→claude fallback shape with formatter trailers (issue #91)', () => {
    const text = [
      '[FALLBACK] {"from":{"provider":"opencode","model":"deepseek-v4-flash-free"},"to":{"provider":"claude","model":"claude-haiku-4-5-20251001"},"reason":"quota"}',
      'Here is the screen result:',
      '```json',
      '{',
      '  "readable": true,',
      '  "company": "Acme",',
      '  "role": "Platform Engineer",',
      '  "score": 7.5,',
      '  "tldr": "Strong platform fit."',
      '}',
      '```',
      '✓ claude done — 1 turns, $0.02, 41s',
      '[USAGE] {"cost_usd":0.02,"input_tokens":900,"output_tokens":80,"model":"claude-haiku-4-5-20251001"}',
      '',
    ].join('\n');
    expect(parseScreenResponse(text)).toEqual({
      readable: true,
      company: 'Acme',
      role: 'Platform Engineer',
      score: 7.5,
      tldr: 'Strong platform fit.',
    });
  });

  it('throws on a response with no fenced block so the offer records as unreadable', () => {
    expect(() => parseScreenResponse('no fence here\n✓ claude done — 1 turns, $0.01, 9s')).toThrow(
      /fenced/i,
    );
  });
});
