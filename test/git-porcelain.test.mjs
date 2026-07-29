import { describe, expect, it } from 'vitest';
import { parseNulPaths, parsePorcelainV1Z } from '../src/lib/git-porcelain.mjs';

describe('Git porcelain v1 -z parser', () => {
  it('preserves whitespace and newlines and expands both rename paths', () => {
    const output = Buffer.from(
      [
        ' M content/line\nbreak.md',
        'R  tmp/private destination.md',
        'content/original source.md ',
        '?? data/new\tprivate.md',
        '',
      ].join('\0'),
    );

    expect(parsePorcelainV1Z(output)).toEqual([
      { code: ' M', path: 'content/line\nbreak.md' },
      { code: 'R ', path: 'tmp/private destination.md' },
      { code: 'R ', path: 'content/original source.md ' },
      { code: '??', path: 'data/new\tprivate.md' },
    ]);
  });

  it('rejects truncated rename records instead of silently losing a path', () => {
    expect(() => parsePorcelainV1Z(Buffer.from('R  content/new.md\0'))).toThrow(
      /missing source path/u,
    );
  });

  it('parses NUL-delimited paths without trimming Git-valid characters', () => {
    expect(
      parseNulPaths(
        Buffer.from(['content/line\nbreak.md', 'content/trailing-space.md ', ''].join('\0')),
      ),
    ).toEqual(['content/line\nbreak.md', 'content/trailing-space.md ']);
  });
});
