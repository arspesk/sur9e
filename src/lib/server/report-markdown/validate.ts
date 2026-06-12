// src/lib/server/report-markdown/validate.ts
//
// The structural + style validators for report markdown. Each validator is a
// pure `(md) => Issue[]` function and is registered in `VALIDATORS` (index.ts).
// Validators never mutate — they only surface findings. `error` issues fail the
// CI gate over fixtures; `warn` issues are logged but never block. Node-only:
// never import from a client component.

import { marked } from 'marked';
import { maskCode } from './fences';
import { CALLOUT_VARIANTS, SANCTIONED_EMOJI } from './rules';
import type { Issue, Validator } from './types';

// The marked.lexer()-based validators (heading-hierarchy, tldr-present,
// over-bold, table-columns, heading-concise) are already code-safe: marked
// emits fenced code as a `code` token, so markup inside it never appears as a
// heading/paragraph/table token. The regex-based validators below instead scan
// `maskCode(md)` (fenced + inline code blanked, length preserved) so markup
// shown inside code is neither counted nor flagged; char offsets still map back
// to the original for the `before` check in next-steps-first.

// ── heading-hierarchy ─────────────────────────────────────────────────────────
// An H4 must have a preceding H3 within the same H2 section; a jump straight
// from H2 to H4 is an orphaned level. We walk headings in order, tracking the
// deepest level seen since the last shallower heading.
const headingHierarchy: Validator = md => {
  const issues: Issue[] = [];
  const tokens = marked.lexer(md);
  let sawH3SinceH2 = false;
  for (const tok of tokens) {
    if (tok.type !== 'heading') continue;
    const depth = tok.depth as number;
    if (depth <= 2) {
      sawH3SinceH2 = false;
    } else if (depth === 3) {
      sawH3SinceH2 = true;
    } else if (depth >= 4 && !sawH3SinceH2) {
      issues.push({
        rule: 'heading-hierarchy',
        severity: 'error',
        message: `H${depth} "${tok.text}" has no preceding H3 parent in its section`,
      });
    }
  }
  return issues;
};

// ── tldr-present ───────────────────────────────────────────────────────────────
// Every report must carry a `## TL;DR` section.
const tldrPresent: Validator = md => {
  const tokens = marked.lexer(md);
  const has = tokens.some(
    t => t.type === 'heading' && t.depth === 2 && /^TL;DR\b/i.test((t.text as string).trim()),
  );
  return has ? [] : [{ rule: 'tldr-present', severity: 'error', message: 'no `## TL;DR` section' }];
};

// ── callout-variant + callout-emoji-palette ────────────────────────────────────
// Each `<div data-callout>` must declare a `data-variant` that is one of the
// four CSS-tinted variants. `data-emoji` is free-form, but a generated emoji off
// the sanctioned palette is a (non-blocking) warn.
const CALLOUT_OPEN_RE = /<div\b[^>]*\bdata-callout\b[^>]*>/gi;
const VARIANT_ATTR_RE = /\bdata-variant="([^"]*)"/i;
const EMOJI_ATTR_RE = /\bdata-emoji="([^"]*)"/i;

const calloutAttrs: Validator = md => {
  const issues: Issue[] = [];
  const matches = maskCode(md).match(CALLOUT_OPEN_RE) ?? [];
  for (const open of matches) {
    const variantMatch = open.match(VARIANT_ATTR_RE);
    const variant = variantMatch?.[1];
    if (!variant || !CALLOUT_VARIANTS.includes(variant as never)) {
      issues.push({
        rule: 'callout-variant',
        severity: 'error',
        message: `data-callout has missing or invalid data-variant${
          variant ? ` ("${variant}")` : ''
        }`,
      });
    }
    const emoji = open.match(EMOJI_ATTR_RE)?.[1];
    if (emoji && !SANCTIONED_EMOJI.has(emoji)) {
      issues.push({
        rule: 'callout-emoji-palette',
        severity: 'warn',
        message: `data-emoji "${emoji}" is off the sanctioned palette`,
      });
    }
  }
  return issues;
};

// ── unbalanced-html ────────────────────────────────────────────────────────────
// `<div data-callout>` and `<details>` opens must each be closed. We count opens
// vs the matching closers; any imbalance is an error.
const DETAILS_OPEN_RE = /<details\b[^>]*>/gi;
const DETAILS_CLOSE_RE = /<\/details>/gi;
const DIV_OPEN_RE = /<div\b[^>]*>/gi;
const DIV_CLOSE_RE = /<\/div>/gi;

const count = (md: string, re: RegExp) => (md.match(re) ?? []).length;

const unbalancedHtml: Validator = md => {
  const issues: Issue[] = [];
  const masked = maskCode(md);
  const calloutOpens = count(masked, CALLOUT_OPEN_RE);
  const divCloses = count(masked, DIV_CLOSE_RE);
  const divOpens = count(masked, DIV_OPEN_RE);
  // A callout is a <div>; if there are more callout/div opens than </div>, the
  // structure is unbalanced. We compare div opens to div closes overall.
  if (calloutOpens > 0 && divOpens !== divCloses) {
    issues.push({
      rule: 'unbalanced-html',
      severity: 'error',
      message: `unmatched <div data-callout> (${divOpens} <div>, ${divCloses} </div>)`,
    });
  }
  const detailsOpens = count(masked, DETAILS_OPEN_RE);
  const detailsCloses = count(masked, DETAILS_CLOSE_RE);
  if (detailsOpens !== detailsCloses) {
    issues.push({
      rule: 'unbalanced-html',
      severity: 'error',
      message: `unmatched <details> (${detailsOpens} open, ${detailsCloses} close)`,
    });
  }
  return issues;
};

// ── heading-concise ────────────────────────────────────────────────────────────
// Headings are bare section names. A takeaway clause — a `:` followed by prose,
// a `;`, or a comma-list — is a (non-blocking) warn. `TL;DR` is the one
// sanctioned label that legitimately carries `;`/`:`.
const headingConcise: Validator = md => {
  const issues: Issue[] = [];
  const tokens = marked.lexer(md);
  for (const tok of tokens) {
    if (tok.type !== 'heading') continue;
    const text = (tok.text as string).trim();
    // Strip a leading bare `TL;DR` label so its own punctuation is not flagged;
    // anything after it (a takeaway clause) is still inspected.
    const rest = text.replace(/^TL;DR/i, '').trim();
    if (rest === '') continue;
    if (/[;,]/.test(rest) || /:\s*\S/.test(rest)) {
      issues.push({
        rule: 'heading-concise',
        severity: 'warn',
        message: `heading "${text}" carries a takeaway clause; use a bare section name`,
      });
    }
  }
  return issues;
};

// ── over-bold ──────────────────────────────────────────────────────────────────
// A paragraph that is entirely wrapped in bold (the #19 fully-bold verdict). Bold
// marks the scan anchor, not the whole block.
const overBold: Validator = md => {
  const issues: Issue[] = [];
  const tokens = marked.lexer(md);
  for (const tok of tokens) {
    if (tok.type !== 'paragraph') continue;
    const text = (tok.text as string).trim();
    if (/^\*\*[\s\S]+\*\*$/.test(text) && !text.slice(2, -2).includes('**')) {
      issues.push({
        rule: 'over-bold',
        severity: 'warn',
        message: 'paragraph is entirely bold; bold only the scan anchor',
      });
    }
  }
  return issues;
};

// ── table-columns ──────────────────────────────────────────────────────────────
// A data row whose raw cell count differs from the header. marked pads rows, so
// we inspect the raw table text line by line.
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function rawCellCount(line: string): number {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|').length;
}

const tableColumns: Validator = md => {
  const issues: Issue[] = [];
  const tokens = marked.lexer(md);
  for (const tok of tokens) {
    if (tok.type !== 'table') continue;
    const lines = (tok.raw as string).split('\n').filter(l => TABLE_ROW_RE.test(l));
    if (lines.length < 2) continue;
    const headerCols = rawCellCount(lines[0]);
    for (let i = 1; i < lines.length; i++) {
      if (TABLE_SEP_RE.test(lines[i])) continue;
      if (rawCellCount(lines[i]) !== headerCols) {
        issues.push({
          rule: 'table-columns',
          severity: 'warn',
          message: `table row has ${rawCellCount(lines[i])} cells, header has ${headerCols}`,
        });
      }
    }
  }
  return issues;
};

// ── next-steps-single + next-steps-first ───────────────────────────────────────
// The single Next Steps callout: a `<div data-callout>` whose body opens with
// `**Next Steps**`. Exactly one must exist (`next-steps-single`), and it must be
// the first body block (`next-steps-first`).
const CALLOUT_BLOCK_RE = /<div\b[^>]*\bdata-callout\b[^>]*>([\s\S]*?)<\/div>/gi;
const NEXT_STEPS_BODY_RE = /^\s*\*\*Next Steps\*\*/;

// Scan masked text so a Next Steps callout shown inside a code fence (an
// example) is not counted; match indices still map to the original md.
function nextStepsBlocks(md: string): RegExpMatchArray[] {
  return [...maskCode(md).matchAll(CALLOUT_BLOCK_RE)].filter(m =>
    NEXT_STEPS_BODY_RE.test(m[1].trim()),
  );
}

const nextStepsSingle: Validator = md => {
  const blocks = nextStepsBlocks(md);
  if (blocks.length === 1) return [];
  return [
    {
      rule: 'next-steps-single',
      severity: 'error',
      message: `expected exactly one Next Steps callout, found ${blocks.length}`,
    },
  ];
};

const nextStepsFirst: Validator = md => {
  const blocks = nextStepsBlocks(md);
  if (blocks.length === 0) return [];
  const first = blocks[0];
  const before = md.slice(0, first.index ?? 0);
  // Anything other than whitespace before the first Next Steps callout means it
  // is not the first body block.
  if (before.trim() !== '') {
    return [
      {
        rule: 'next-steps-first',
        severity: 'error',
        message: 'Next Steps callout is not the first body block',
      },
    ];
  }
  return [];
};

export const VALIDATORS: Validator[] = [
  headingHierarchy,
  tldrPresent,
  calloutAttrs,
  unbalancedHtml,
  headingConcise,
  overBold,
  tableColumns,
  nextStepsSingle,
  nextStepsFirst,
];
