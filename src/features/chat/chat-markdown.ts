// Client-safe markdown → HTML for assistant replies. Mirrors the sanitizing
// Marked recipe in src/lib/server/reports.ts (lines 26-44): raw HTML tokens
// are escaped so model output quoting untrusted JD/web content can't inject
// markup; links open in a new tab with rel hardening and non-http(s)
// schemes are neutralized. marked is already a dependency — no new deps.

import { Marked } from 'marked';
import { escapeHtml } from '@/lib/escape-html';

const markedChat = new Marked({
  async: false,
  gfm: true,
  // breaks:true keeps the messaging-app feel — a lone `\n` inside a paragraph
  // becomes a soft `<br>`, so hand-wrapped prose reads the way it was typed.
  // On its own that defeats blank-line block separation for streamed model
  // output (tables get extra rows, indented bullets render as literal text) —
  // but `breaks` only governs INLINE newlines, never block tokenization. The
  // `preprocessChatMarkdown` pass below inserts the missing blank lines (and
  // de-indents accidental lists) BEFORE marked runs, so tables + lists always
  // tokenize correctly while prose keeps its soft-wrap feel. Verified against
  // the exact failing shapes in test/chat-markdown.preprocess.test.ts; flipping
  // to breaks:false was unnecessary once the preprocessor guarantees the block
  // boundaries, and it would strip the intended chat line-break behavior.
  breaks: true,
  renderer: {
    html({ text }: { text: string }): string {
      // Raw HTML blocks render as literal text, never as markup.
      return escapeHtml(text);
    },
    code({ text, lang }: { text: string; lang?: string }): string {
      // Fenced code → wrapper with a copy button. The button lives in the
      // HTML string (this renders via dangerouslySetInnerHTML); message-view
      // handles its click by delegation. Native <button> keeps keyboard
      // activation (Enter/Space) working without any JS here.
      const language = (lang ?? '').split(/\s+/)[0];
      const cls = language ? ` class="language-${escapeHtml(language)}"` : '';
      return (
        '<div class="chat-codeblock">' +
        '<button type="button" class="chat-codeblock__copy" aria-label="Copy code">Copy</button>' +
        `<pre><code${cls}>${escapeHtml(text)}</code></pre>` +
        '</div>'
      );
    },
    link({ href, text }: { href: string; text: string }): string {
      const safe = /^(https?:|mailto:|\/)/i.test(href) ? href : '#';
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener">${escapeHtml(text)}</a>`;
    },
    image({ href, title, text }: { href: string; title: string | null; text: string }): string {
      // Same scheme allowlist as links, plus data:image (inline images the
      // model may emit) — anything else is dropped to a broken ref. Belt-and-
      // suspenders: an <img> src never executes script, but neutralizing odd
      // schemes keeps the sanitizer's scheme policy uniform.
      const safe = /^(https?:|\/|data:image\/)/i.test(href) ? href : '#';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${titleAttr} loading="lazy">`;
    },
  },
});

// ── block-boundary preprocessor ──────────────────────────────────────────────
// Streamed text-deltas are concatenated verbatim (fold-events.ts) and handed
// straight to marked, so the model's missing blank lines never get repaired.
// This pass restores the block boundaries GFM needs. The table regexes and the
// cell/fence approach are ported (not imported — that module is Node-only) from
// src/lib/server/report-markdown/{auto-fix,fences}.ts.

// A run of `| … |` lines is a table; the 2nd line is the `|---|` separator.
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
// A list-item line: 0+ leading spaces, a bullet/ordered marker, whitespace, and
// at least one non-space char (so `---`, `***`, and empty markers don't match).
const LIST_MARKER_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+\S/;
// Looser test for "was the previous emitted line already a list item?".
const LIST_LINE_RE = /^\s*([-*+]|\d{1,9}[.)])\s/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** Count leading space characters (tabs are left alone — conservative). */
function leadingSpaces(line: string): number {
  const m = line.match(/^ */);
  return m ? m[0].length : 0;
}

/** Remove up to `n` leading spaces from a line. */
function stripLeading(line: string, n: number): string {
  const strip = Math.min(n, leadingSpaces(line));
  return line.slice(strip);
}

/**
 * Insert the blank lines GFM needs to tokenize tables and lists, and de-indent
 * single-level lists that were accidentally indented under a paragraph. Runs
 * before marked.parse. Fenced code blocks (``` / ~~~) are passed through
 * untouched, so pipes/markers shown inside code never become tables or lists.
 */
export function preprocessChatMarkdown(md: string): string {
  const lines = md.split('\n');

  // Annotate fenced-code membership (ported from fences.ts: fence lines count
  // as in-code so their interior is never rewritten).
  const inCode: boolean[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const m = line.match(FENCE_RE);
    if (fence === null && m) {
      fence = m[1][0];
      inCode.push(true);
    } else if (fence !== null) {
      inCode.push(true);
      if (m && m[1][0] === fence) fence = null;
    } else {
      inCode.push(false);
    }
  }

  const out: string[] = [];
  // When non-null, we are inside a list block; the number is how many leading
  // spaces to strip from the block's lines (0 = a normal, non-de-indented list).
  let listDeindent: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inCode[i]) {
      out.push(line);
      listDeindent = null;
      continue;
    }

    // ── table block: bracket it with blank lines so the row run tokenizes and
    // a following paragraph is never swallowed as extra `<td>` rows. ──
    if (
      TABLE_ROW_RE.test(line) &&
      i + 1 < lines.length &&
      !inCode[i + 1] &&
      TABLE_SEP_RE.test(lines[i + 1])
    ) {
      if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
      let j = i;
      while (j < lines.length && !inCode[j] && TABLE_ROW_RE.test(lines[j])) {
        out.push(lines[j]);
        j++;
      }
      if (j < lines.length && lines[j].trim() !== '') out.push('');
      listDeindent = null;
      i = j - 1;
      continue;
    }

    // ── list handling ──
    const lm = LIST_MARKER_RE.exec(line);
    if (lm) {
      if (listDeindent !== null) {
        // Continuing an established list block — keep its de-indent so nested
        // items (and the accidental block's later items) stay consistent.
        out.push(stripLeading(line, listDeindent));
        continue;
      }
      const indent = lm[1].length;
      const prev = out[out.length - 1];
      const prevBlank = prev === undefined || prev.trim() === '';
      const prevIsList = prev !== undefined && LIST_LINE_RE.test(prev);
      if (!prevBlank && !prevIsList) {
        // A list marker directly under a paragraph line. GFM (with breaks:true)
        // renders this as literal text — a blank line before it fixes that, and
        // an indented marker here can't be indented code (that needs a blank
        // line above), so any indent is accidental → de-indent to column 0.
        out.push('');
        listDeindent = indent >= 1 ? indent : 0;
        out.push(stripLeading(line, listDeindent));
        continue;
      }
      // A normal list (follows a blank line or another list item). Leave its
      // indentation alone — this preserves intentional nested lists.
      listDeindent = 0;
      out.push(line);
      continue;
    }

    // ── non-list line inside an open list block ──
    if (listDeindent !== null) {
      if (line.trim() === '') {
        out.push(line); // a blank keeps a loose list open
        continue;
      }
      const lead = leadingSpaces(line);
      if (listDeindent > 0 && lead >= listDeindent) {
        out.push(stripLeading(line, listDeindent)); // continuation of a de-indented item
        continue;
      }
      if (listDeindent === 0 && lead > 0) {
        out.push(line); // continuation of a normal list item
        continue;
      }
      // A dedented paragraph ends the list.
      listDeindent = null;
    }

    out.push(line);
  }

  return out.join('\n');
}

export function renderChatMarkdown(md: string): string {
  const html = markedChat.parse(preprocessChatMarkdown(md)) as string;
  // marked emits a bare `<table>` for its table token (our renderers escape any
  // literal `<table>` in prose/code to `&lt;…&gt;`, so this only ever matches a
  // real table). Wrap each in an overflow-x scroller so a wide table scrolls
  // horizontally inside the message instead of stretching the layout, while the
  // table itself keeps `display:table` for correct column sizing (see chat.css).
  return html
    .replace(/<table>/g, '<div class="chat-md__table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');
}
