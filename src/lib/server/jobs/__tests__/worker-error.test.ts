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

  it('preserves signal-kill null semantics in the fallback', () => {
    expect(workerErrorFromOutput('', null)).toBe('exit null');
  });

  it('caps the subtitle to one line-ish length; full text stays in logs', () => {
    const long = `ERROR: ${'x'.repeat(300)}`;
    const result = workerErrorFromOutput(long, 1);
    expect(result.length).toBeLessThanOrEqual(200 + ' (exit 1)'.length);
    expect(result.endsWith('… (exit 1)')).toBe(true);
  });
});
