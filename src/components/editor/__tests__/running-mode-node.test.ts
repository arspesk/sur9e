import { describe, expect, it } from 'vitest';
import {
  isStaleRunningMode,
  parseRunningModeComment,
  preprocessRunningModeComments,
  runningModeCommentToDiv,
  serializeRunningModeToComment,
} from '../extensions/running-mode-node';

describe('runningMode node serialization', () => {
  it('round-trips through the HTML comment', () => {
    const attrs = {
      mode: 'evaluate',
      num: 16,
      startedAt: '2026-05-25T12:34:56Z',
      label: 'Evaluation',
    };
    const comment = serializeRunningModeToComment(attrs);
    expect(comment).toMatch(/^<!-- sur9e:running /);
    const parsed = parseRunningModeComment(comment);
    expect(parsed).toEqual(attrs);
  });

  it('returns null for non-matching comments', () => {
    expect(parseRunningModeComment('<!-- something else -->')).toBeNull();
    expect(parseRunningModeComment('plain text')).toBeNull();
  });

  it('flags runs older than 30 minutes as stale', () => {
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const fresh = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(isStaleRunningMode(old)).toBe(true);
    expect(isStaleRunningMode(fresh)).toBe(false);
  });
});

describe('runningMode reload reconstruction (R2-6)', () => {
  const attrs = {
    mode: 'cover-letter',
    num: 16,
    startedAt: '2026-05-29T12:34:56.000Z',
    label: 'Running Cover letter…',
  };

  it('rewrites a comment line into a self-describing div with the same attrs', () => {
    const comment = serializeRunningModeToComment(attrs);
    const div = runningModeCommentToDiv(comment);
    expect(div).toMatch(/^<div data-running-mode /);
    expect(div).toContain(`data-mode="${attrs.mode}"`);
    expect(div).toContain(`data-num="${attrs.num}"`);
    expect(div).toContain(`data-started="${attrs.startedAt}"`);
    expect(div).toContain(`data-label="${attrs.label}"`);
  });

  it('passes non-comment lines through unchanged', () => {
    expect(runningModeCommentToDiv('## Snapshot')).toBe('## Snapshot');
    expect(runningModeCommentToDiv('')).toBe('');
    expect(runningModeCommentToDiv('<!-- some other comment -->')).toBe(
      '<!-- some other comment -->',
    );
  });

  it('preprocesses a full body line-by-line, only touching comment lines', () => {
    const comment = serializeRunningModeToComment(attrs);
    const body = ['# Title', '', 'Some prose.', comment, '', '## Next section'].join('\n');
    const out = preprocessRunningModeComments(body);
    const lines = out.split('\n');
    expect(lines[0]).toBe('# Title');
    expect(lines[2]).toBe('Some prose.');
    expect(lines[3]).toMatch(/^<div data-running-mode /);
    expect(lines[5]).toBe('## Next section');
  });

  it('is a no-op for bodies with no running-mode comment', () => {
    const body = '# Title\n\nNo running modes here.';
    expect(preprocessRunningModeComments(body)).toBe(body);
  });

  it('round-trips comment → div attrs back into the original parse shape', () => {
    // Mirror parseHTML getAttrs: read the data-* attributes off the div and
    // confirm they reproduce the original RunningModeAttrs.
    const div = runningModeCommentToDiv(serializeRunningModeToComment(attrs));
    const read = (name: string) => {
      const m = div.match(new RegExp(`${name}="([^"]*)"`));
      return m ? m[1] : '';
    };
    const reconstructed = {
      mode: read('data-mode'),
      num: Number(read('data-num')),
      startedAt: read('data-started'),
      label: read('data-label'),
    };
    expect(reconstructed).toEqual(attrs);
  });
});
