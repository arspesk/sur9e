// src/lib/server/__tests__/parse-error.test.ts
//
// describeParseError turns YAML / zod / generic failures into a short,
// banner-sized message: js-yaml errors keep only their first line and carry
// a 1-based line number; zod errors collapse to `path: message` pairs.

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeParseError } from '../parse-error';

function yamlError(input: string): unknown {
  try {
    yaml.load(input);
  } catch (err) {
    return err;
  }
  throw new Error('fixture unexpectedly parsed');
}

describe('describeParseError', () => {
  it('YAMLException: keeps the first message line and a 1-based line number', () => {
    const err = yamlError('candidate:\n  full_name: "unterminated\n');
    const info = describeParseError(err);
    expect(info.message).toBe('unexpected end of the stream within a double quoted scalar (3:1)');
    expect(info.message).not.toContain('\n');
    // js-yaml's mark.line is 0-based (2) — surfaced as 1-based (3).
    expect(info.line).toBe(3);
  });

  it('ZodError: collapses issues to `path: message` pairs', () => {
    const result = z
      .object({ candidate: z.object({ full_name: z.string() }) })
      .safeParse({ candidate: { full_name: 123 } });
    expect(result.success).toBe(false);
    if (result.success) return;
    const info = describeParseError(result.error);
    expect(info.message).toContain('candidate.full_name:');
    expect(info.line).toBeNull();
  });

  it('ZodError: a root-level issue is labeled (root)', () => {
    const result = z.object({ a: z.string() }).safeParse('not-an-object');
    expect(result.success).toBe(false);
    if (result.success) return;
    const info = describeParseError(result.error);
    expect(info.message).toMatch(/^\(root\): /);
  });

  it('generic Error and non-Error values fall through to their message/string', () => {
    expect(describeParseError(new Error('boom'))).toEqual({ message: 'boom', line: null });
    expect(describeParseError('plain string')).toEqual({ message: 'plain string', line: null });
  });
});
