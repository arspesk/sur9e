// src/lib/server/jobs/__tests__/worker-error.test.ts
//
// workerErrorFromOutput — the failed card's subtitle must surface the
// worker's actionable 'ERROR: …' line instead of the opaque 'exit 1'
// (UI/UX audit 2026-06-10, "Failed job card surfaces only 'exit 1'").

import { describe, expect, it } from 'vitest';
import { workerErrorFromOutput } from '../runner';

describe('workerErrorFromOutput', () => {
  it("surfaces the worker's ERROR line with the exit code appended", () => {
    const output = [
      'scanning…',
      'ERROR: inputs/personalization/cv.md missing — run onboarding first',
      '',
    ].join('\n');
    expect(workerErrorFromOutput(output, 1)).toBe(
      'inputs/personalization/cv.md missing — run onboarding first (exit 1)',
    );
  });

  it('takes the LAST ERROR line when several exist', () => {
    const output = ['ERROR: first failure', 'retrying…', 'ERROR: final failure'].join('\n');
    expect(workerErrorFromOutput(output, 2)).toBe('final failure (exit 2)');
  });

  it('matches indented ERROR lines too', () => {
    expect(workerErrorFromOutput('  ERROR: pipeline.md missing', 1)).toBe(
      'pipeline.md missing (exit 1)',
    );
  });

  it("falls back to 'exit N' when no marker is present", () => {
    expect(workerErrorFromOutput('just ordinary logs', 1)).toBe('exit 1');
  });

  it("falls back to 'exit N' on a bare ERROR: with no message", () => {
    expect(workerErrorFromOutput('ERROR:', 1)).toBe('exit 1');
  });

  it('renders a friendly interrupted line for a signal-kill (code null), not "exit null"', () => {
    // A signal-killed worker (code === null, e.g. an external kill or OOM) used
    // to surface the opaque, raw 'exit null'. It now gets a human sentence —
    // mirrors humanize-error.ts's parallel 'interrupted' treatment on the
    // chat-turn side.
    expect(workerErrorFromOutput('', null)).toBe('The job was interrupted before it finished.');
  });

  it('tags an ERROR line from a signal-killed run as "(interrupted)", not "(exit null)"', () => {
    expect(workerErrorFromOutput('ERROR: pipeline stalled', null)).toBe(
      'pipeline stalled (interrupted)',
    );
  });

  it('caps the subtitle to one line-ish length; full text stays in logs', () => {
    const long = `ERROR: ${'x'.repeat(300)}`;
    const result = workerErrorFromOutput(long, 1);
    expect(result.length).toBeLessThanOrEqual(200 + ' (exit 1)'.length);
    expect(result.endsWith('… (exit 1)')).toBe(true);
  });

  it('surfaces a mode-runner ❌ line (batch/mode-runner.mjs uses ❌, not ERROR:)', () => {
    const output = ['mode=cover-letter provider=claude', '❌ artifact write failed: ENOSPC'].join(
      '\n',
    );
    expect(workerErrorFromOutput(output, 1)).toBe('artifact write failed: ENOSPC (exit 1)');
  });

  it('extracts a clean cause from a REAL failed run (ANSI + sentinels + HTML tail)', () => {
    // The exact shape a failed cover-letter run persists: a tee'd ANSI-laden
    // warning, a leaked HTML 404 page, the `<<<SUR9E_*>>>` envelope, the ❌
    // parse-fail line (whose message itself embeds a sentinel token), and a
    // trailing 'exit 1'. Today this surfaces the bare 'exit 1'.
    const output = [
      'mode=cover-letter provider=claude model=claude-opus (resolved from mode_default)',
      '\x1b[2m⚠️ output parse failed: no <<<SUR9E_OUTPUT>>> sentinel in response — retrying once\x1b[0m',
      '<!DOCTYPE html>',
      '<html><head><title>404 Not Found</title></head>',
      '\x1b[31m❌ output parse failed on retry: no <<<SUR9E_OUTPUT>>> sentinel in response\x1b[0m',
      '<<<SUR9E_END>>>',
      '</html>',
      'exit 1',
    ].join('\n');

    const result = workerErrorFromOutput(output, 1);

    // The actionable cause surfaces, cleaned: sentinel token scrubbed to a
    // neutral word, no ANSI escapes, no raw HTML, and NOT the bare 'exit 1'.
    expect(result).toBe('output parse failed on retry: no output sentinel in response (exit 1)');
    expect(result).not.toMatch(/^exit \d+$/);
    expect(result).not.toContain('<<<SUR9E');
    expect(result).not.toMatch(/\x1b/);
    expect(result).not.toContain('<!DOCTYPE');
    expect(result).not.toContain('</html>');
    expect(result).toContain('(exit 1)');
  });
});
