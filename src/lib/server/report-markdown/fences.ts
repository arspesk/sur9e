// src/lib/server/report-markdown/fences.ts
//
// Shared code-block / inline-code awareness for the normalizer. The spec's core
// promise is that fixers and validators never mutate or false-flag markup shown
// INSIDE a fenced code block or an inline `code` span. These helpers are the one
// place that logic lives. Node-only: never import from a client component.

/** A line annotated with whether it sits inside a fenced code block. */
export interface AnnotatedLine {
  text: string;
  inCode: boolean;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;
// Inline code spans: a run of backticks, content, the same run length. We keep
// it simple (no internal backticks) which covers report inline code like `x`.
const INLINE_CODE_RE = /(`+)([^`]*?)\1/g;

/**
 * Annotate each line of `md` with whether it is inside a fenced code block (the
 * fence delimiter lines themselves count as in-code so they are left untouched).
 */
export function annotateLines(md: string): AnnotatedLine[] {
  const lines = md.split('\n');
  const out: AnnotatedLine[] = [];
  let fence: string | null = null;
  for (const text of lines) {
    const m = text.match(FENCE_RE);
    if (fence === null && m) {
      fence = m[2][0]; // ` or ~
      out.push({ text, inCode: true });
      continue;
    }
    if (fence !== null) {
      out.push({ text, inCode: true });
      if (m && m[2][0] === fence) fence = null; // closing fence
      continue;
    }
    out.push({ text, inCode: false });
  }
  return out;
}

/** Char-offset ranges [start, end) of every line inside a fenced code block. */
export function codeCharRanges(md: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  for (const { text, inCode } of annotateLines(md)) {
    if (inCode) ranges.push([offset, offset + text.length]);
    offset += text.length + 1; // + the '\n'
  }
  return ranges;
}

/**
 * Apply `fn` to a single line's text OUTSIDE any inline-code span, leaving the
 * `code` spans verbatim. Used by the per-line prose fixers (em-dash, color span)
 * so an em dash or span shown inside `inline code` is not rewritten.
 */
export function mapOutsideInlineCode(line: string, fn: (s: string) => string): string {
  // split() with a capturing group interleaves prose (even idx) and code (odd).
  const parts = line.split(/(`+[^`]*?`+)/);
  return parts.map((seg, i) => (i % 2 === 1 ? seg : fn(seg))).join('');
}

/**
 * Replace matches of `re` in `md` only when the match starts OUTSIDE a fenced
 * code block. Used by multi-line fixers (empty-node) that cannot work line by
 * line. `re` must be global.
 */
export function replaceOutsideCode(
  md: string,
  re: RegExp,
  replacer: (match: string) => string,
): string {
  const ranges = codeCharRanges(md);
  const inCode = (idx: number) => ranges.some(([s, e]) => idx >= s && idx < e);
  return md.replace(re, (match: string, ...args: unknown[]) => {
    const offset = args[args.length - 2] as number;
    return inCode(offset) ? match : replacer(match);
  });
}

/**
 * Return `md` with every code region (fenced blocks and inline `code` spans)
 * replaced by spaces, preserving length and newlines. Validators scan this
 * masked text so markup shown inside code is neither counted nor flagged, while
 * character offsets and line numbers still map back to the original.
 */
export function maskCode(md: string): string {
  return annotateLines(md)
    .map(({ text, inCode }) => {
      if (inCode) return ' '.repeat(text.length);
      return text.replace(INLINE_CODE_RE, m => ' '.repeat(m.length));
    })
    .join('\n');
}
