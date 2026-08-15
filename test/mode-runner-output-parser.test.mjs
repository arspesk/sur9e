// test/mode-runner-output-parser.test.mjs
import { describe, expect, it } from 'vitest';
import {
  extractSentinelPayload,
  extractTrailingFence,
  stripTerminalNoise,
} from '../batch/lib/output-parser.mjs';

// Synthetic STDOUT fixtures for the lenient-recovery paths. These previously
// read real captured logs from batch/logs/modes/, but that directory is
// gitignored — it holds the user's real run logs (personal data that must
// never reach the public repo, and which CI never checks out). Inlining keeps
// the exact structural shapes the recovery path must handle, with no real data
// and no gitignored-file dependency.
const FENCE = '```';

// END sentinel present but the opening OUTPUT line dropped, with a **Note:**
// preamble that recovery must strip.
const NO_OUTPUT_SENTINEL_STDOUT = [
  '**Note:** Here is the cover letter, ready for the PDF step.',
  'format: letter',
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head><meta charset="UTF-8" /><title>Cover Letter</title></head>',
  '<body>',
  '<p>Dear Hiring Team,</p>',
  "<p>I'm excited to apply for the role.</p>",
  '<p>Sincerely,<br />A. Candidate</p>',
  '</body>',
  '</html>',
  '<<<SUR9E_END>>>',
].join('\n');

// No sentinels at all: a **Note:** preamble, then the format line and the HTML
// each wrapped in its own markdown fence.
const FULLY_FENCED_STDOUT = [
  "**Note:** I've written the cover letter as a complete HTML document below.",
  FENCE,
  'format: letter',
  FENCE,
  `${FENCE}html`,
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head><meta charset="UTF-8" /><title>Cover Letter</title></head>',
  '<body>',
  '<p>Dear Hiring Team,</p>',
  "<p>I'm excited to apply.</p>",
  '</body>',
  '</html>',
  FENCE,
].join('\n');

// The lenient recovery pdf.mjs passes: anchor the deliverable on its opening
// `format:` line.
const PDF_RECOVER = { recover: { startRe: /^format:\s*(letter|a4)\b/i } };

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

describe('extractSentinelPayload — lenient pdf recovery from degraded output', () => {
  it('recovers the HTML when END is present but the opening OUTPUT line was dropped', () => {
    // A run where the model emitted the closing <<<SUR9E_END>>> but omitted the
    // opening <<<SUR9E_OUTPUT>>> (observed live with big-pickle).
    const stdout = NO_OUTPUT_SENTINEL_STDOUT;
    // Without recovery this is the exact failure users hit.
    expect(() => extractSentinelPayload(stdout)).toThrow(/sentinel/i);

    const payload = extractSentinelPayload(stdout, PDF_RECOVER);
    expect(payload).toMatch(/^format:\s*letter/);
    expect(payload).toContain('<html');
    expect(payload).toContain('</html>');
    // No sentinel text and no stray preamble leaked into the deliverable.
    expect(payload).not.toContain('SUR9E_END');
    expect(payload).not.toContain('SUR9E_OUTPUT');
    expect(payload).not.toMatch(/\*\*Note:\*\*/);

    // ...and the downstream pdf.mjs parse contract is satisfiable.
    const html = payload.slice(payload.indexOf('\n') + 1).trim();
    expect(/<html[\s>]/i.test(html)).toBe(true);
  });

  it('recovers the HTML from a fully code-fenced response with no sentinels at all', () => {
    // A "**Note:**" preamble, then the format line and the HTML each wrapped in
    // markdown fences, no sentinels at all (observed live with big-pickle).
    const stdout = FULLY_FENCED_STDOUT;
    expect(() => extractSentinelPayload(stdout)).toThrow(/sentinel/i);

    const payload = extractSentinelPayload(stdout, PDF_RECOVER);
    expect(payload).toMatch(/^format:\s*letter/);
    expect(payload).toContain('<html');
    expect(payload).toContain('</html>');
    // Preamble and fence markers are stripped out of the deliverable.
    expect(payload).not.toMatch(/\*\*Note:\*\*/);
    expect(payload).not.toContain('```');
  });

  it('leaves a clean, well-formed sentinel pair untouched (no regression)', () => {
    const html = '<!DOCTYPE html>\n<html lang="en"><body>Hi</body></html>';
    const text = `<<<SUR9E_OUTPUT>>>\nformat: letter\n${html}\n<<<SUR9E_END>>>`;
    // Same result with or without the recover option — the strict path wins.
    expect(extractSentinelPayload(text)).toBe(`format: letter\n${html}`);
    expect(extractSentinelPayload(text, PDF_RECOVER)).toBe(`format: letter\n${html}`);
  });

  it('unwraps a payload that is entirely wrapped in a markdown fence', () => {
    const inner = 'format: a4\n<!DOCTYPE html><html><body>x</body></html>';
    const text = `<<<SUR9E_OUTPUT>>>\n\`\`\`html\n${inner}\n\`\`\`\n<<<SUR9E_END>>>`;
    expect(extractSentinelPayload(text, PDF_RECOVER)).toBe(inner);
  });

  it('still throws on pure garbage even with recovery enabled', () => {
    expect(() => extractSentinelPayload('just some rambling, no deliverable', PDF_RECOVER)).toThrow(
      /sentinel/i,
    );
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

  it('parses the fence when stream-formatter trailer lines follow it (issue #91)', () => {
    // A claude-routed run pipes through cli/stream-claude-parser.mjs, whose
    // re-emitted stdout ends with "✓ claude done — …" and "[USAGE] {…}" AFTER
    // the model's fenced payload. A fallback run also prepends "[FALLBACK]".
    const text = [
      '[FALLBACK] {"from":{"provider":"opencode"},"to":{"provider":"claude"},"reason":"quota"}',
      'Screening the posting now.',
      '```json',
      '{"readable": true, "company": "Acme", "score": 7.5}',
      '```',
      '✓ claude done — 1 turns, $0.02, 41s',
      '[USAGE] {"cost_usd":0.02,"input_tokens":900,"output_tokens":80,"model":"claude-haiku-4-5-20251001"}',
      '',
    ].join('\n');
    expect(extractTrailingFence(text)).toEqual({ readable: true, company: 'Acme', score: 7.5 });
  });

  it('still throws when only trailer lines exist and no fence at all', () => {
    const text = [
      'some chatter, no fenced block',
      '✓ claude done — 2 turns, $0.10, 1m02s',
      '[USAGE] {"cost_usd":0.1}',
    ].join('\n');
    expect(() => extractTrailingFence(text)).toThrow(/fenced/i);
  });

  it('does not strip trailer-shaped lines inside the fenced payload', () => {
    // Only lines AFTER the closing fence are formatter noise; identical-looking
    // content inside the payload must survive.
    const text = [
      '```yaml',
      'company: Acme',
      'note: "[USAGE] is a formatter marker"',
      '```',
      '✓ claude done — 1 turns, $0.01, 12s',
    ].join('\n');
    expect(extractTrailingFence(text)).toEqual({
      company: 'Acme',
      note: '[USAGE] is a formatter marker',
    });
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
