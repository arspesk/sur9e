// test/mode-runner-output-parser.test.mjs
import { describe, expect, it } from 'vitest';
import {
  extractSentinelPayload,
  extractTrailingFence,
  stripTerminalNoise,
} from '../batch/lib/output-parser.mjs';

describe('extractSentinelPayload', () => {
  it('returns the payload between the sentinels', () => {
    const text = `thinking…\n<<<SUR9E_OUTPUT>>>\nhello world\n<<<SUR9E_END>>>\n`;
    expect(extractSentinelPayload(text)).toBe('hello world');
  });

  it('takes the LAST sentinel pair when the model echoes the contract', () => {
    const text = [
      'The contract says use <<<SUR9E_OUTPUT>>> … <<<SUR9E_END>>> markers.',
      '<<<SUR9E_OUTPUT>>>',
      'real payload',
      '<<<SUR9E_END>>>',
    ].join('\n');
    expect(extractSentinelPayload(text)).toBe('real payload');
  });

  it('preserves interior fenced blocks and frontmatter dashes verbatim', () => {
    const payload = `---\ncompany: Acme\n---\n\n## TL;DR\n\n\`\`\`\nscript\n\`\`\``;
    const text = `<<<SUR9E_OUTPUT>>>\n${payload}\n<<<SUR9E_END>>>`;
    expect(extractSentinelPayload(text)).toBe(payload);
  });

  it('throws when no sentinel pair exists', () => {
    expect(() => extractSentinelPayload('no markers here')).toThrow(/sentinel/i);
  });

  it('throws when the payload is empty', () => {
    expect(() => extractSentinelPayload('<<<SUR9E_OUTPUT>>>\n\n<<<SUR9E_END>>>')).toThrow(/empty/i);
  });
});

describe('extractTrailingFence', () => {
  it('parses the trailing fenced JSON block', () => {
    const text = 'prose\n```json\n{"a": 1}\n```\n';
    expect(extractTrailingFence(text)).toEqual({ a: 1 });
  });

  it('parses YAML inside the fence (yaml is a JSON superset)', () => {
    const text = '```yaml\na: 1\nb: two\n```';
    expect(extractTrailingFence(text)).toEqual({ a: 1, b: 'two' });
  });

  it('throws when there is no trailing fence', () => {
    expect(() => extractTrailingFence('nothing')).toThrow(/fenced/i);
  });
});

describe('stripTerminalNoise', () => {
  it('removes OSC notify streams and CSI codes around sentinels', () => {
    const polluted =
      ']777;notify;warp://cli-agent;{"event":"x"}[0m\n<<<SUR9E_OUTPUT>>>\n[1m## TL;DR[0m\nbody\n<<<SUR9E_END>>>\n[0m';
    expect(extractSentinelPayload(polluted)).toBe('## TL;DR\nbody');
  });

  it('removes ESC-stripped CSI remnants like [0m inside the payload', () => {
    const polluted = '<<<SUR9E_OUTPUT>>>\n[0m# [0mTodos gone\nreal content\n<<<SUR9E_END>>>';
    expect(extractSentinelPayload(polluted)).toBe('# Todos gone\nreal content');
  });
});

describe('line-anchored sentinel selection', () => {
  it('ignores inline marker MENTIONS in a sign-off after the real pair', () => {
    const text = [
      '<<<SUR9E_OUTPUT>>>',
      '---',
      'company: PwC',
      '---',
      '',
      '## TL;DR',
      'real content',
      '<<<SUR9E_END>>>',
      '',
      'Report emitted between `<<<SUR9E_OUTPUT>>>` / `<<<SUR9E_END>>>` sentinels — score 3.5.',
    ].join('\n');
    const payload = extractSentinelPayload(text);
    expect(payload).toContain('company: PwC');
    expect(payload).toContain('real content');
    expect(payload).not.toContain('Report emitted');
  });

  it('skips a junk pair and falls back to the previous well-formed pair', () => {
    const text = [
      '<<<SUR9E_OUTPUT>>>',
      'good payload',
      '<<<SUR9E_END>>>',
      'chatter',
      '<<<SUR9E_OUTPUT>>>',
      '<<<SUR9E_END>>>',
    ].join('\n');
    expect(extractSentinelPayload(text)).toBe('good payload');
  });
});
