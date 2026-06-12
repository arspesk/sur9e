// src/lib/server/report-markdown/auto-fix.ts
//
// The deterministic auto-fix transforms for report markdown. Each fixer is a
// pure `(md) => { md, fixes }` function and is registered in `AUTO_FIXES`
// (index.ts) in a fixed order — `unescape` runs before the callout converters
// so escaped Obsidian markers (`\[!callout\]`) are already unescaped when the
// callout fixer sees them. Fixers are block-aware: they never touch the
// interior of a fenced code block. Node-only: never import from a client
// component.

import { type ScoreTier, scoreLevel, TIER_MARK_COLOR } from '@/lib/scoring';
import { annotateLines, mapOutsideInlineCode, replaceOutsideCode } from './fences';
import { EMOJI_TO_VARIANT, OBSIDIAN_TO_VARIANT, SANCTIONED_EMOJI } from './rules';
import type { AutoFix, Fix } from './types';

/** Run a per-prose-line transform, leaving fenced-code lines untouched. */
function mapProseLines(
  md: string,
  rule: string,
  fn: (line: string) => string,
): { md: string; fixes: Fix[] } {
  const annotated = annotateLines(md);
  const fixes: Fix[] = [];
  const out = annotated.map(({ text, inCode }, i) => {
    if (inCode) return text;
    const next = fn(text);
    if (next !== text) fixes.push({ rule, before: text, after: next, line: i + 1 });
    return next;
  });
  return { md: out.join('\n'), fixes };
}

// ── unescape ────────────────────────────────────────────────────────────────
// Remove a backslash before any of our known serializer-escaped characters
// when outside a fenced block. The editor's tiptap-markdown serializer escapes
// `# ~ [ ] * _` defensively; none of these need escaping in our report bodies.
const UNESCAPE_RE = /\\([#~[\]*_])/g;

const unescape: AutoFix = md =>
  mapProseLines(md, 'unescape', line => line.replace(UNESCAPE_RE, '$1'));

// ── pdf-line ─────────────────────────────────────────────────────────────────
// Drop a body line of the form `**PDF:** …` — the download belongs in the
// Attachments section, not inline in the body.
const PDF_LINE_RE = /^\s*\*\*PDF:\*\*\s/;

const pdfLine: AutoFix = md => {
  const annotated = annotateLines(md);
  const fixes: Fix[] = [];
  const kept: string[] = [];
  annotated.forEach(({ text, inCode }, i) => {
    if (!inCode && PDF_LINE_RE.test(text)) {
      fixes.push({ rule: 'pdf-line', before: text, after: '', line: i + 1 });
      return;
    }
    kept.push(text);
  });
  return { md: kept.join('\n'), fixes };
};

// ── blank-lines ──────────────────────────────────────────────────────────────
// Collapse 3+ consecutive blank lines to a single blank line. Safe across code
// blocks: marked treats blank lines as block separators regardless.
const blankLines: AutoFix = md => {
  const after = md.replace(/\n{3,}/g, '\n\n');
  const fixes: Fix[] = after === md ? [] : [{ rule: 'blank-lines', before: md, after }];
  return { md: after, fixes };
};

// ── blockquote-callout + obsidian-callout ────────────────────────────────────
// Convert emoji-led or Obsidian-style blockquote callouts into
// `<div data-callout data-variant data-emoji>` blocks. Runs after `unescape`,
// so an escaped Obsidian marker (`\[!callout\]`) is already `[!callout]` here.

/** Strip a leading `>` (and one optional space) from a blockquote line. */
function stripQuote(line: string): string {
  return line.replace(/^\s*>\s?/, '');
}

/** Detect the leading sanctioned emoji of a blockquote-callout body. */
function leadingEmoji(text: string): string | null {
  for (const emoji of SANCTIONED_EMOJI) {
    if (text.startsWith(emoji)) return emoji;
  }
  return null;
}

/** Detect a leading Obsidian `[!kind]` marker; returns the lowercased kind. */
function obsidianKind(text: string): string | null {
  const m = text.match(/^\[!\s*([a-zA-Z]+)\s*\]/);
  return m ? m[1].toLowerCase() : null;
}

/** Emit a data-callout block from a callout body. */
function calloutBlock(variant: string, emoji: string | null, body: string): string {
  const attrs = emoji
    ? `data-callout data-variant="${variant}" data-emoji="${emoji}"`
    : `data-callout data-variant="${variant}"`;
  return `<div ${attrs}>\n\n${body.trim()}\n\n</div>`;
}

const blockquoteCallout: AutoFix = md => {
  const annotated = annotateLines(md);
  const fixes: Fix[] = [];
  const out: string[] = [];
  let i = 0;
  while (i < annotated.length) {
    const { text, inCode } = annotated[i];
    if (inCode || !/^\s*>/.test(text)) {
      out.push(text);
      i++;
      continue;
    }
    // Gather the full consecutive blockquote.
    const start = i;
    const quoteLines: string[] = [];
    while (i < annotated.length && !annotated[i].inCode && /^\s*>/.test(annotated[i].text)) {
      quoteLines.push(stripQuote(annotated[i].text));
      i++;
    }
    const joined = quoteLines.join('\n').trim();
    const emoji = leadingEmoji(joined);
    const kind = emoji ? null : obsidianKind(joined);
    if (emoji) {
      const variant = EMOJI_TO_VARIANT[emoji] ?? 'info';
      const block = calloutBlock(variant, emoji, joined.slice(emoji.length));
      fixes.push({
        rule: 'blockquote-callout',
        before: quoteLines.map(l => `> ${l}`).join('\n'),
        after: block,
        line: start + 1,
      });
      out.push(block);
    } else if (kind) {
      const variant = OBSIDIAN_TO_VARIANT[kind] ?? 'info';
      const body = joined.replace(/^\[!\s*[a-zA-Z]+\s*\]\s*/, '');
      const block = calloutBlock(variant, null, body);
      fixes.push({
        rule: 'obsidian-callout',
        before: quoteLines.map(l => `> ${l}`).join('\n'),
        after: block,
        line: start + 1,
      });
      out.push(block);
    } else {
      // A plain blockquote (e.g. a bare section takeaway) — leave untouched.
      for (let j = start; j < i; j++) out.push(annotated[j].text);
    }
  }
  return { md: out.join('\n'), fixes };
};

// ── inline-color-span ────────────────────────────────────────────────────────
// Unwrap stray text-color spans the editor serializes mid-word
// (`tr<span style="color: …">oublesho</span>oting`). Color emphasis is not in
// the contract — callouts and `<mark>` carry signal instead.
const COLOR_SPAN_RE = /<span\b[^>]*\bstyle="[^"]*\bcolor\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;

const inlineColorSpan: AutoFix = md =>
  mapProseLines(md, 'inline-color-span', line =>
    mapOutsideInlineCode(line, seg => seg.replace(COLOR_SPAN_RE, '$1')),
  );

// ── empty-node ───────────────────────────────────────────────────────────────
// Strip empty placeholder nodes the editor leaves behind: empty `<details>`,
// empty `<div data-callout>`, and a dangling lone `>` blockquote line. "Empty"
// means no visible text once tags are removed.

/** True when an HTML fragment has no visible text content. */
function hasNoText(fragment: string): boolean {
  return (
    fragment
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, '')
      .trim() === ''
  );
}

const EMPTY_BLOCK_RE = /<(details|div)\b[^>]*>[\s\S]*?<\/\1>/gi;

const emptyNode: AutoFix = md => {
  const fixes: Fix[] = [];
  // Strip empty <details>…</details> and <div data-callout>…</div> blocks,
  // but never ones shown inside a fenced code block.
  let out = replaceOutsideCode(md, EMPTY_BLOCK_RE, match => {
    const isCallout = /^<div\b[^>]*\bdata-callout\b/i.test(match);
    const isDetails = /^<details\b/i.test(match);
    if ((isCallout || isDetails) && hasNoText(match)) {
      fixes.push({ rule: 'empty-node', before: match, after: '' });
      return '';
    }
    return match;
  });
  // Drop dangling lone `>` blockquote lines (outside code).
  const dangling = mapProseLines(out, 'empty-node', line => (/^\s*>\s*$/.test(line) ? '' : line));
  out = dangling.md;
  fixes.push(...dangling.fixes);
  return { md: out, fixes };
};

// Em/en dashes are intentionally NOT normalized: the comma replacement mangled
// numeric ranges ($190–220K -> "$190, 220K", 2–3 -> "2, 3") and read awkwardly,
// so dashes are allowed in report prose.

// ── score-tier-color ─────────────────────────────────────────────────────────
// Color the Score and Read cells of the TL;DR `Axis | Score | Read` table by
// the score tier (Section 4.3). Detects the table by its header carrying both a
// `Score` and a `Read` column; for each data row, wraps both cells in
// `<mark data-color>` using `scoreLevel` + `TIER_MARK_COLOR` from lib/scoring.
// Idempotent: a cell already wrapped in the correct mark is left alone.

/** Split a markdown table row into trimmed cell strings (no leading/trailing |). */
function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(c => c.trim());
}

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

/** Strip every <mark>/</mark> tag, recovering a colored cell's plain text. */
function stripMarks(s: string): string {
  return s.replace(/<\/?mark\b[^>]*>/g, '');
}

/** Wrap a cell's text in a tier mark, unless it already is correctly wrapped. */
function markCell(text: string, color: string): { cell: string; changed: boolean } {
  const already = new RegExp(
    `^<mark data-color="${color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">.*</mark>$`,
  );
  if (already.test(text)) return { cell: text, changed: false };
  // Strip any prior (possibly mis-colored) mark wrapper before re-wrapping.
  const inner = text.replace(/^<mark\b[^>]*>([\s\S]*)<\/mark>$/, '$1');
  return { cell: `<mark data-color="${color}">${inner}</mark>`, changed: true };
}

const scoreTierColor: AutoFix = md => {
  const annotated = annotateLines(md);
  const fixes: Fix[] = [];
  const out = annotated.map(a => a.text);
  for (let i = 0; i < annotated.length - 1; i++) {
    if (annotated[i].inCode) continue;
    const headerLine = annotated[i].text;
    const sepLine = annotated[i + 1].text;
    if (!TABLE_ROW_RE.test(headerLine) || !TABLE_SEP_RE.test(sepLine)) continue;
    const header = tableCells(headerLine).map(h => h.toLowerCase());
    const scoreIdx = header.indexOf('score');
    const readIdx = header.indexOf('read');
    if (scoreIdx === -1 || readIdx === -1) continue;
    // Walk data rows until the table ends.
    let r = i + 2;
    while (r < annotated.length && !annotated[r].inCode && TABLE_ROW_RE.test(annotated[r].text)) {
      const cells = tableCells(annotated[r].text);
      const rawScore = stripMarks(cells[scoreIdx] ?? '');
      const n = Number.parseFloat(rawScore);
      if (cells[scoreIdx] !== undefined && cells[readIdx] !== undefined && !Number.isNaN(n)) {
        const color = TIER_MARK_COLOR[scoreLevel(n)];
        const scoreCell = markCell(cells[scoreIdx], color);
        const readCell = markCell(cells[readIdx], color);
        if (scoreCell.changed || readCell.changed) {
          const before = annotated[r].text;
          cells[scoreIdx] = scoreCell.cell;
          cells[readIdx] = readCell.cell;
          const after = `| ${cells.join(' | ')} |`;
          out[r] = after;
          fixes.push({ rule: 'score-tier-color', before, after, line: r + 1 });
        }
      }
      r++;
    }
    i = r - 1;
  }
  return { md: out.join('\n'), fixes };
};

// ── fit-column-color ─────────────────────────────────────────────────────────
// Color the "Fit" cells of the Role-summary table by JD-fit tier (Section 4.x).
// Detects the table by its header carrying both a `Fit` column and a
// `Requirement`/`JD` column; for each data row, maps the Fit cell's inner text
// (direct→high, strong→mid, adjacent→low) and wraps the original-cased value in
// `<mark data-color>` via TIER_MARK_COLOR. Unknown values are left plain.
// Idempotent: the value is re-derived from the (mark-stripped) inner text each
// run, and `markCell` leaves a correctly-wrapped cell alone.

/** Map a Role-summary Fit label to its score tier, or null when unrecognized. */
function fitTier(value: string): ScoreTier | null {
  const inner = stripMarks(value).trim().toLowerCase();
  if (inner === 'direct') return 'high';
  if (inner === 'strong') return 'mid';
  if (inner === 'adjacent') return 'low';
  return null;
}

const fitColumnColor: AutoFix = md => {
  const annotated = annotateLines(md);
  const fixes: Fix[] = [];
  const out = annotated.map(a => a.text);
  for (let i = 0; i < annotated.length - 1; i++) {
    if (annotated[i].inCode) continue;
    const headerLine = annotated[i].text;
    const sepLine = annotated[i + 1].text;
    if (!TABLE_ROW_RE.test(headerLine) || !TABLE_SEP_RE.test(sepLine)) continue;
    const header = tableCells(headerLine).map(h => h.toLowerCase());
    const fitIdx = header.findIndex(h => /^fit$/.test(h));
    const reqIdx = header.findIndex(h => /requirement|jd/.test(h));
    if (fitIdx === -1 || reqIdx === -1) continue;
    // Walk data rows until the table ends.
    let r = i + 2;
    while (r < annotated.length && !annotated[r].inCode && TABLE_ROW_RE.test(annotated[r].text)) {
      const cells = tableCells(annotated[r].text);
      const cell = cells[fitIdx];
      if (cell !== undefined) {
        const tier = fitTier(cell);
        if (tier) {
          const marked = markCell(cell, TIER_MARK_COLOR[tier]);
          if (marked.changed) {
            const before = annotated[r].text;
            cells[fitIdx] = marked.cell;
            const after = `| ${cells.join(' | ')} |`;
            out[r] = after;
            fixes.push({ rule: 'fit-column-color', before, after, line: r + 1 });
          }
        }
      }
      r++;
    }
    i = r - 1;
  }
  return { md: out.join('\n'), fixes };
};

// ── interview-metrics-color ──────────────────────────────────────────────────
// Color the Difficulty + Positive % cells of the interview-process table
// (Rounds | Days | Difficulty | Positive %) by tier, same visual treatment as
// the TL;DR axis table. Difficulty is favorable when LOW (easier interview):
// < 2.5 green, 2.5-3.5 yellow, > 3.5 red. Positive % is favorable when HIGH:
// ≥ 60 green, 40-59 yellow, < 40 red. Modes emit plain values; this paints
// them. Idempotent: tier is re-derived from the mark-stripped inner text.

function difficultyTier(value: string): ScoreTier | null {
  const n = Number.parseFloat(stripMarks(value));
  if (Number.isNaN(n)) return null;
  if (n < 2.5) return 'high';
  if (n <= 3.5) return 'mid';
  return 'low';
}

function positivePctTier(value: string): ScoreTier | null {
  const n = Number.parseFloat(stripMarks(value).replace('%', ''));
  if (Number.isNaN(n)) return null;
  if (n >= 60) return 'high';
  if (n >= 40) return 'mid';
  return 'low';
}

const interviewMetricsColor: AutoFix = md => {
  const annotated = annotateLines(md);
  const fixes: Fix[] = [];
  const out = annotated.map(a => a.text);
  for (let i = 0; i < annotated.length - 1; i++) {
    if (annotated[i].inCode) continue;
    const headerLine = annotated[i].text;
    const sepLine = annotated[i + 1].text;
    if (!TABLE_ROW_RE.test(headerLine) || !TABLE_SEP_RE.test(sepLine)) continue;
    const header = tableCells(headerLine).map(h => h.toLowerCase());
    const diffIdx = header.findIndex(h => /difficult/.test(h));
    const posIdx = header.findIndex(h => /positive/.test(h));
    // Anchor to the interview-process table shape (Rounds | Days | …) so a
    // future table whose header merely contains "Difficulty"/"Positive" is not
    // mis-colored as interview metrics.
    const hasShape = header.some(h => /round|days/.test(h));
    if (!hasShape || (diffIdx === -1 && posIdx === -1)) continue;
    let r = i + 2;
    while (r < annotated.length && !annotated[r].inCode && TABLE_ROW_RE.test(annotated[r].text)) {
      const cells = tableCells(annotated[r].text);
      let changed = false;
      if (diffIdx !== -1 && cells[diffIdx] !== undefined) {
        const tier = difficultyTier(cells[diffIdx]);
        if (tier) {
          const marked = markCell(cells[diffIdx], TIER_MARK_COLOR[tier]);
          if (marked.changed) {
            cells[diffIdx] = marked.cell;
            changed = true;
          }
        }
      }
      if (posIdx !== -1 && cells[posIdx] !== undefined) {
        const tier = positivePctTier(cells[posIdx]);
        if (tier) {
          const marked = markCell(cells[posIdx], TIER_MARK_COLOR[tier]);
          if (marked.changed) {
            cells[posIdx] = marked.cell;
            changed = true;
          }
        }
      }
      if (changed) {
        const before = annotated[r].text;
        const after = `| ${cells.join(' | ')} |`;
        out[r] = after;
        fixes.push({ rule: 'interview-metrics-color', before, after, line: r + 1 });
      }
      r++;
    }
    i = r - 1;
  }
  return { md: out.join('\n'), fixes };
};

// ── full-bold-to-quote ───────────────────────────────────────────────────────
// A block-level paragraph that, after trimming, is ENTIRELY one bold span and
// whose inner text has ≥ 6 words is a section takeaway dressed as a full-bold
// sentence — convert it to a blockquote (Section 4.x / locked decision 4). Bold
// stays reserved for short labels + a few decision-driving keywords. Skips code
// fences, `<div data-callout>` interiors, headings/list-items/table rows, and
// existing blockquotes. Idempotent: a `>` blockquote is never re-bolded.

const FULL_BOLD_RE = /^\*\*([\s\S]+)\*\*$/;

/** True when a (trimmed) block is a single bold span with no unbolded text. */
function isWholeBold(block: string): boolean {
  const m = block.match(FULL_BOLD_RE);
  if (!m) return false;
  // Reject blocks with an interior bold boundary (e.g. `**a** b **c**`), which
  // would mean the block is not a single span. A lone span has no `**` inside.
  return !m[1].includes('**');
}

/** Word count of inner text (whitespace-separated, ignoring empties). */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const fullBoldToQuote: AutoFix = md => {
  const annotated = annotateLines(md);
  const fixes: Fix[] = [];
  const out: string[] = [];
  // Track whether we are inside a `<div data-callout>` block; the empty-node /
  // blockquote-callout fixers run earlier, so by now callouts are real divs.
  let calloutDepth = 0;
  let i = 0;
  while (i < annotated.length) {
    const { text, inCode } = annotated[i];
    if (inCode) {
      out.push(text);
      i++;
      continue;
    }
    const opensCallout = /^<div\b[^>]*\bdata-callout\b/i.test(text);
    // A single-line callout (`<div data-callout ...>Body.</div>`) opens and
    // closes on one line — net-zero depth. Counting only the open (the else-if
    // skips the same-line close) would wedge calloutDepth at 1 and silently
    // disable this fixer for the rest of the document.
    const closesOnSameLine = opensCallout && /<\/div>\s*$/i.test(text);
    if (opensCallout && !closesOnSameLine) calloutDepth++;
    else if (!opensCallout && calloutDepth > 0 && /^<\/div>/i.test(text)) calloutDepth--;
    // Only blank-line-delimited paragraphs are candidates; blank lines, callout
    // interiors, and single-line callout lines pass through verbatim.
    if (text.trim() === '' || calloutDepth > 0 || closesOnSameLine) {
      out.push(text);
      i++;
      continue;
    }
    const start = i;
    const para: string[] = [];
    while (i < annotated.length && !annotated[i].inCode && annotated[i].text.trim() !== '') {
      para.push(annotated[i].text);
      i++;
    }
    const joined = para.join('\n');
    const trimmed = joined.trim();
    const first = para[0] ?? '';
    const isHeading = /^\s*#{1,6}\s/.test(first);
    const isList = /^\s*([-*+]|\d+\.)\s/.test(first);
    const isTable = TABLE_ROW_RE.test(first);
    const isQuote = /^\s*>/.test(first);
    if (
      !isHeading &&
      !isList &&
      !isTable &&
      !isQuote &&
      isWholeBold(trimmed) &&
      wordCount(trimmed.replace(FULL_BOLD_RE, '$1')) >= 6
    ) {
      const inner = trimmed.replace(FULL_BOLD_RE, '$1');
      const after = inner
        .split('\n')
        .map(l => `> ${l}`)
        .join('\n');
      fixes.push({ rule: 'full-bold-to-quote', before: joined, after, line: start + 1 });
      out.push(after);
    } else {
      out.push(...para);
    }
  }
  return { md: out.join('\n'), fixes };
};

export const AUTO_FIXES: AutoFix[] = [
  unescape,
  pdfLine,
  blockquoteCallout,
  inlineColorSpan,
  emptyNode,
  scoreTierColor,
  fitColumnColor,
  interviewMetricsColor,
  fullBoldToQuote,
  blankLines,
];
