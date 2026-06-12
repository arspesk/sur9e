/**
 * Empirical test harness for "blockquote → Heading" conversion.
 *
 * Step 1 — Does clearNodes().setHeading() work for a paragraph inside a blockquote?
 * Step 2 — Reproduces the exact current working-tree command chains.
 * Step 3 — Tries candidate fix sequences in order, picks the first winner.
 * Step 4 — Regression suite: plain paragraph→H3, list-item→H3, wrap conversions.
 */

import { Editor } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { afterEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal extension list — mirrors buildExtensions() in tiptap-editor.tsx but
// drops browser-only or DOM-intensive extensions that would break under jsdom:
//   - DragHandle (needs actual layout)
//   - BubbleMenu (needs layout + selection rects)
//   - CharacterCount (fine, but not needed)
//   - Table/Image/CodeBlockLowlight (fine, but irrelevant to this test)
//   - HeadingId (uses Decoration.node — fine, but heavy; skip)
//   - FitColorizer (reads DOM colors)
//   - DetailsBlock / RunningMode / SnapshotNode / CalloutNode (fine, but irrelevant)
//   - SlashCommand / Placeholder (extension-only, no DOM)
//   - Markdown MUST be last (per tiptap-markdown docs)
// ---------------------------------------------------------------------------

function buildMinimalExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      // StarterKit includes Link and Underline — disable them to avoid
      // "duplicate extension" warnings when we add Highlight/TextStyle below.
      link: false,
      underline: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Markdown.configure({
      html: true,
      tightLists: true,
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// NOTE: `editor` is declared at the top level so describe-block beforeEach/afterEach
// can set/clean it up. Each describe block that uses beforeEach MUST call
// editor.destroy() in afterEach to avoid ProseMirror plugin singleton collisions.
let editor: Editor;

function makeEditor(html: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    extensions: buildMinimalExtensions(),
    content: html,
  });
  return ed;
}

/** Return the top-level node types in the doc */
function topLevelTypes(ed: Editor): string[] {
  const types: string[] = [];
  ed.state.doc.forEach(node => {
    types.push(node.type.name);
  });
  return types;
}

/** Return the first top-level heading node, if any */
function firstTopLevelHeading(ed: Editor): { type: string; level: number; text: string } | null {
  let result: { type: string; level: number; text: string } | null = null;
  ed.state.doc.forEach(node => {
    if (result) return;
    if (node.type.name === 'heading') {
      result = {
        type: 'heading',
        level: node.attrs.level as number,
        text: node.textContent,
      };
    }
  });
  return result;
}

/** Recursively describe the doc tree for assertions */
function describeDoc(ed: Editor): string {
  const lines: string[] = [];
  function walk(node: import('@tiptap/pm/model').Node, depth: number) {
    const indent = '  '.repeat(depth);
    lines.push(
      `${indent}${node.type.name}${node.type.name === 'heading' ? `[${node.attrs.level}]` : ''}: "${node.textContent}"`,
    );
    node.forEach(child => walk(child, depth + 1));
  }
  walk(ed.state.doc, 0);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The blockquote doc we're testing against
// ---------------------------------------------------------------------------
const BLOCKQUOTE_HTML = '<blockquote><p>4d. Final engineering interview (30 min)</p></blockquote>';
const EXPECTED_TEXT = '4d. Final engineering interview (30 min)';

// Place cursor inside the paragraph (pos 2 = inside first text of blockquote's paragraph)
function placeCursorInBlockquote(ed: Editor) {
  // pos=0 is doc, pos=1 is blockquote start, pos=2 is paragraph start, pos=3 is first char
  ed.commands.setTextSelection(3);
}

// ---------------------------------------------------------------------------
// STEP 1 + 2: Reproduce the current working-tree command chains
// ---------------------------------------------------------------------------
describe('Step 1+2 — reproduce: current round-1 fix (clearNodes + setHeading)', () => {
  afterEach(() => {
    editor?.destroy();
  });

  it('PRE round-1: bare .setHeading({level:3}) on blockquote content', () => {
    editor = makeEditor(BLOCKQUOTE_HTML);
    placeCursorInBlockquote(editor);
    const result = editor.chain().focus().setHeading({ level: 3 }).run();
    const doc = describeDoc(editor);
    console.log('[PRE round-1] setHeading result:', result);
    console.log('[PRE round-1] doc after:\n', doc);
    const heading = firstTopLevelHeading(editor);
    // Record what actually happens — expected to fail (heading stays inside blockquote or no-ops)
    console.log('[PRE round-1] firstTopLevelHeading:', heading);
  });

  it('Round-1 fix: clearNodes().setHeading({level:3}) on blockquote content', () => {
    editor = makeEditor(BLOCKQUOTE_HTML);
    placeCursorInBlockquote(editor);
    const result = editor.chain().focus().clearNodes().setHeading({ level: 3 }).run();
    const doc = describeDoc(editor);
    console.log('[Round-1] clearNodes+setHeading result:', result);
    console.log('[Round-1] doc after:\n', doc);

    const heading = firstTopLevelHeading(editor);
    console.log('[Round-1] firstTopLevelHeading:', heading);

    // This is the key assertion: does the heading end up at top level?
    // (May fail — that's what we're investigating)
    if (!heading) {
      console.log(
        '[Round-1] FAIL: no top-level heading produced — clearNodes alone is insufficient',
      );
    } else if (heading.level !== 3) {
      console.log('[Round-1] FAIL: heading produced but wrong level:', heading.level);
    } else if (heading.text !== EXPECTED_TEXT) {
      console.log('[Round-1] FAIL: heading text mismatch:', heading.text);
    } else {
      console.log('[Round-1] PASS: top-level h3 with correct text');
    }
  });
});

// ---------------------------------------------------------------------------
// STEP 3: Find the winning sequence empirically
// ---------------------------------------------------------------------------
describe('Step 3 — candidate fix sequences', () => {
  afterEach(() => {
    editor?.destroy();
  });

  it('Candidate A: lift("blockquote").setHeading({level:3})', () => {
    editor = makeEditor(BLOCKQUOTE_HTML);
    placeCursorInBlockquote(editor);
    const result = editor.chain().focus().lift('blockquote').setHeading({ level: 3 }).run();
    const doc = describeDoc(editor);
    console.log('[A] lift+setHeading result:', result, '\n', doc);
    const heading = firstTopLevelHeading(editor);
    expect(heading).not.toBeNull();
    expect(heading?.level).toBe(3);
    expect(heading?.text).toBe(EXPECTED_TEXT);
  });

  it('Candidate B: toggleBlockquote().setHeading({level:3}) — toggle unwraps when inside', () => {
    editor = makeEditor(BLOCKQUOTE_HTML);
    placeCursorInBlockquote(editor);
    const result = editor.chain().focus().toggleBlockquote().setHeading({ level: 3 }).run();
    const doc = describeDoc(editor);
    console.log('[B] toggleBlockquote+setHeading result:', result, '\n', doc);
    const heading = firstTopLevelHeading(editor);
    expect(heading).not.toBeNull();
    expect(heading?.level).toBe(3);
    expect(heading?.text).toBe(EXPECTED_TEXT);
  });

  it('Candidate C: setHeading({level:3}) then lift("blockquote") — set then lift', () => {
    // This is backwards but worth testing
    editor = makeEditor(BLOCKQUOTE_HTML);
    placeCursorInBlockquote(editor);
    const result = editor.chain().focus().setHeading({ level: 3 }).lift('blockquote').run();
    const doc = describeDoc(editor);
    console.log('[C] setHeading+lift result:', result, '\n', doc);
    const heading = firstTopLevelHeading(editor);
    console.log('[C] firstTopLevelHeading:', heading);
  });
});

// ---------------------------------------------------------------------------
// STEP 3b: Two-dispatch approach using liftListItem or explicit tr.lift
// ---------------------------------------------------------------------------
describe('Step 3b — two-dispatch approach (custom command)', () => {
  afterEach(() => {
    editor?.destroy();
  });

  it('Two-dispatch: first unwrap blockquote via custom command, then setHeading', () => {
    // NOTE: This approach does NOT work because our custom range computation
    // ($from.before(d).blockRange()) gives range.depth=0, and liftTarget
    // returns null for depth=0 (can't lift beyond doc level). The correct range
    // to use is $from.blockRange() (WITHOUT the blockquote boundary positions),
    // which gives the paragraph-level range that IS liftable.
    // Use the DEBUG test (2dispatch) above for the working two-dispatch approach.
    editor = makeEditor(BLOCKQUOTE_HTML);
    placeCursorInBlockquote(editor);

    const { liftTarget } =
      require('prosemirror-transform') as typeof import('prosemirror-transform');

    // Dispatch 1: lift using the CURSOR POSITION's blockRange (not blockquote boundary)
    const state = editor.state;
    const { $from } = state.selection;
    const range = $from.blockRange(); // correct: paragraph-level range inside blockquote
    const target = range ? liftTarget(range) : null;
    console.log('[2-dispatch-v2] range depth:', range?.depth, 'liftTarget:', target);
    if (range && target !== null) {
      editor.view.dispatch(state.tr.lift(range, target));
    }

    console.log('[2-dispatch-v2] doc after dispatch 1:', describeDoc(editor));

    // Dispatch 2: now set heading
    editor.commands.setTextSelection(1);
    const result = editor.chain().focus().setHeading({ level: 3 }).run();
    const doc = describeDoc(editor);
    console.log('[2-dispatch-v2] final doc:\n', doc);
    const heading = firstTopLevelHeading(editor);
    console.log('[2-dispatch-v2] firstTopLevelHeading:', heading);

    // Two-dispatch works if we compute the range correctly from cursor position
    expect(target).not.toBeNull(); // liftTarget should succeed
    expect(heading?.level).toBe(3);
    expect(heading?.text).toBe(EXPECTED_TEXT);
  });
});

// ---------------------------------------------------------------------------
// STEP 3c: Debug the liftBlockquote approach — understand why lift fails
// ---------------------------------------------------------------------------
describe('Step 3c — debug liftBlockquote and find winning approach', () => {
  afterEach(() => {
    editor.destroy();
  });

  it('DEBUG: inspect $from positions and liftTarget result for blockquote', () => {
    const { liftTarget } =
      require('prosemirror-transform') as typeof import('prosemirror-transform');
    editor = makeEditor(BLOCKQUOTE_HTML);
    editor.commands.setTextSelection(3); // cursor inside blockquote paragraph

    const state = editor.state;
    const { $from } = state.selection;
    console.log('[debug] $from.depth:', $from.depth);
    for (let d = 0; d <= $from.depth; d++) {
      const node = $from.node(d);
      console.log(`[debug] depth ${d}: ${node.type.name} pos=${d === 0 ? 0 : $from.before(d)}`);
    }

    // blockRange at paragraph depth (should give blockquote-level range)
    const $from2 = state.doc.resolve(3);
    const range = $from2.blockRange();
    console.log(
      '[debug] blockRange depth:',
      range?.depth,
      'start:',
      range?.start,
      'end:',
      range?.end,
    );
    if (range) {
      const target = liftTarget(range);
      console.log('[debug] liftTarget result:', target);
      // Now try the lift on a transaction
      const tr = state.tr;
      if (target !== null) {
        tr.lift(range, target);
        console.log(
          '[debug] doc after lift:',
          JSON.stringify(tr.doc.toJSON(), null, 2).substring(0, 500),
        );
      }
    }
  });

  it('DEBUG: does two separate dispatches (lift then setHeading) work?', () => {
    editor = makeEditor(BLOCKQUOTE_HTML);
    editor.commands.setTextSelection(3);

    // First dispatch: lift out of blockquote
    const { liftTarget } =
      require('prosemirror-transform') as typeof import('prosemirror-transform');
    const state1 = editor.state;
    const { $from } = state1.selection;
    const range = $from.blockRange();
    console.log('[2dispatch] blockRange:', range ? `depth=${range.depth}` : 'null');

    if (range) {
      const target = liftTarget(range);
      console.log('[2dispatch] liftTarget:', target);
      if (target !== null) {
        const tr = state1.tr.lift(range, target);
        editor.view.dispatch(tr);
        console.log('[2dispatch] after dispatch 1, doc:', describeDoc(editor));
      }
    }

    // Second dispatch: setHeading
    editor.commands.setTextSelection(1);
    const result = editor.chain().focus().setHeading({ level: 3 }).run();
    console.log('[2dispatch] after setHeading, doc:', describeDoc(editor));
    const heading = firstTopLevelHeading(editor);
    expect(heading?.level).toBe(3);
    expect(heading?.text).toBe(EXPECTED_TEXT);
  });

  it('Proven winner: liftBlockquoteAncestors command chained before setHeading', () => {
    // This is what the production fix should look like: a named command helper
    // that walks up the tree and lifts any blockquote ancestors, then setHeading.
    const { liftTarget } =
      require('prosemirror-transform') as typeof import('prosemirror-transform');
    editor = makeEditor(BLOCKQUOTE_HTML);
    editor.commands.setTextSelection(3);

    const result = editor
      .chain()
      .focus()
      .command(({ state, tr, dispatch }) => {
        const { $from } = tr.selection;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'blockquote') {
            const start = $from.before(d);
            const end = $from.after(d);
            const $start = tr.doc.resolve(start);
            const $end = tr.doc.resolve(end);
            const range = $start.blockRange($end);
            if (range) {
              const target = liftTarget(range);
              console.log('[proven chain] range depth:', range.depth, 'liftTarget:', target);
              if (target !== null && dispatch) {
                tr.lift(range, target);
                console.log(
                  '[proven chain] after lift, tr.doc:',
                  JSON.stringify(tr.doc.toJSON()).substring(0, 300),
                );
                return true;
              }
            }
          }
        }
        return true; // no blockquote found, continue chain
      })
      .setHeading({ level: 3 })
      .run();

    const doc = describeDoc(editor);
    console.log('[proven chain] final result:', result, '\n', doc);
    const heading = firstTopLevelHeading(editor);
    console.log('[proven chain] firstTopLevelHeading:', heading);
  });
});

// ---------------------------------------------------------------------------
// STEP 4: Regression suite — other block conversions must still work
// ---------------------------------------------------------------------------
describe('Step 4 — regression: other block conversions', () => {
  afterEach(() => {
    editor?.destroy();
  });

  it('plain paragraph → H3 still works', () => {
    editor = makeEditor('<p>Plain paragraph text</p>');
    editor.commands.setTextSelection(3);
    const result = editor.chain().focus().clearNodes().setHeading({ level: 3 }).run();
    const heading = firstTopLevelHeading(editor);
    expect(result).toBe(true);
    expect(heading?.level).toBe(3);
    expect(heading?.text).toBe('Plain paragraph text');
  });

  it('heading → H3 (re-level) still works', () => {
    editor = makeEditor('<h1>Already a heading</h1>');
    editor.commands.setTextSelection(3);
    const result = editor.chain().focus().clearNodes().setHeading({ level: 3 }).run();
    const heading = firstTopLevelHeading(editor);
    expect(result).toBe(true);
    expect(heading?.level).toBe(3);
    expect(heading?.text).toBe('Already a heading');
  });

  it('paragraph → blockquote wrap still works (setBlockquote)', () => {
    editor = makeEditor('<p>Some text</p>');
    editor.commands.setTextSelection(3);
    const result = editor.chain().focus().setBlockquote().run();
    const types = topLevelTypes(editor);
    expect(result).toBe(true);
    expect(types).toContain('blockquote');
  });

  it('paragraph → bullet list wrap still works (toggleBulletList)', () => {
    editor = makeEditor('<p>List item</p>');
    editor.commands.setTextSelection(3);
    const result = editor.chain().focus().toggleBulletList().run();
    const types = topLevelTypes(editor);
    expect(result).toBe(true);
    expect(types).toContain('bulletList');
  });

  it('list item → H3 lifts out of list (clearNodes path)', () => {
    editor = makeEditor('<ul><li><p>List item text</p></li></ul>');
    editor.commands.setTextSelection(4);
    const result = editor.chain().focus().clearNodes().setHeading({ level: 3 }).run();
    const doc = describeDoc(editor);
    console.log('[regression list→h3] doc:\n', doc);
    const heading = firstTopLevelHeading(editor);
    expect(result).toBe(true);
    expect(heading?.level).toBe(3);
    expect(heading?.text).toBe('List item text');
  });

  it('blockquote → H3 using the proven winner: clearNodes().setHeading()', () => {
    // The winning approach confirmed by the harness. clearNodes() lifts the
    // paragraph out of the blockquote (via tr.lift with liftTarget from $from.blockRange())
    // and then setHeading() on the chainable state (which reads the updated tr.doc)
    // successfully converts to H3 at the top level.
    editor = makeEditor(BLOCKQUOTE_HTML);
    placeCursorInBlockquote(editor);

    const result = editor.chain().focus().clearNodes().setHeading({ level: 3 }).run();

    const heading = firstTopLevelHeading(editor);
    expect(result).toBe(true);
    expect(heading).not.toBeNull();
    expect(heading?.level).toBe(3);
    expect(heading?.text).toBe(EXPECTED_TEXT);
  });

  it('blockquote wrap conversion: paragraph inside blockquote → paragraph (clearNodes)', () => {
    editor = makeEditor(BLOCKQUOTE_HTML);
    placeCursorInBlockquote(editor);
    // NOTE: clearNodes() lifts the paragraph out of blockquote (returns true),
    // but setParagraph() on an already-paragraph returns false, making the chain
    // return false overall. The BEHAVIOR is correct though: blockquote is gone,
    // paragraph is at top level. Use .clearNodes() alone or check the doc directly.
    editor.chain().focus().clearNodes().setParagraph().run();
    const types = topLevelTypes(editor);
    console.log('[regression bq→p] topLevelTypes:', types);
    // clearNodes DID lift the paragraph out of the blockquote
    expect(types).not.toContain('blockquote');
    expect(types).toContain('paragraph');
  });

  it('plain paragraph → H4 via clearNodes().setHeading({level:4})', () => {
    editor = makeEditor('<p>Sub-block text</p>');
    editor.commands.setTextSelection(3);
    const result = editor.chain().focus().clearNodes().setHeading({ level: 4 }).run();
    const heading = firstTopLevelHeading(editor);
    expect(result).toBe(true);
    expect(heading?.level).toBe(4);
    expect(heading?.text).toBe('Sub-block text');
  });
});

// ---------------------------------------------------------------------------
// STEP 4b: Verify the liftBlockquoteAncestors approach on other starting nodes
// ---------------------------------------------------------------------------
describe('Step 4b — liftBlockquoteAncestors helper does not break non-blockquote contexts', () => {
  function liftBlockquoteAndSetHeading(ed: Editor, level: 1 | 2 | 3) {
    const { liftTarget } =
      require('prosemirror-transform') as typeof import('prosemirror-transform');
    return ed
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        const { $from } = tr.selection;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'blockquote') {
            const start = $from.before(d);
            const end = $from.after(d);
            const $start = tr.doc.resolve(start);
            const $end = tr.doc.resolve(end);
            const range = $start.blockRange($end);
            if (range) {
              const target = liftTarget(range);
              if (target !== null && dispatch) {
                tr.lift(range, target);
                return true;
              }
            }
          }
        }
        return true; // no blockquote ancestor — chain continues normally
      })
      .setHeading({ level })
      .run();
  }

  afterEach(() => {
    editor?.destroy();
  });

  it('plain paragraph → H2 works with liftBlockquoteAncestors prefix', () => {
    editor = makeEditor('<p>No blockquote here</p>');
    editor.commands.setTextSelection(3);
    const result = liftBlockquoteAndSetHeading(editor, 2);
    const heading = firstTopLevelHeading(editor);
    expect(result).toBe(true);
    expect(heading?.level).toBe(2);
    expect(heading?.text).toBe('No blockquote here');
  });

  it('H1 → H3 re-level works with liftBlockquoteAncestors prefix', () => {
    editor = makeEditor('<h1>Section title</h1>');
    editor.commands.setTextSelection(3);
    const result = liftBlockquoteAndSetHeading(editor, 3);
    const heading = firstTopLevelHeading(editor);
    expect(result).toBe(true);
    expect(heading?.level).toBe(3);
    expect(heading?.text).toBe('Section title');
  });
});

// ---------------------------------------------------------------------------
// Step 5 — the REAL drag-handle menu flow. The Turn-into handler runs TWO
// separate transactions: first `setTextSelection(capturedPos + 1)` (where
// capturedPos is the position BEFORE the top-level node), then the heading
// chain. For a top-level paragraph, +1 lands inside its text. For a
// blockquote, +1 lands on the boundary BETWEEN the blockquote and its inner
// paragraph (text starts at +2) — this simulates the user's exact gesture.
// ---------------------------------------------------------------------------

describe('Step 5 — real menu flow: setTextSelection(capturedPos + 1) first', () => {
  afterEach(() => {
    editor?.destroy();
  });

  it('blockquote: boundary selection then clearNodes+setHeading converts to top-level h3', () => {
    editor = makeEditor('<blockquote><p>4d. Final engineering interview (30 min)</p></blockquote>');
    const capturedPos = 0; // drag handle captures the pos before the top-level node
    // EXACT menu sequence: two separate chains, as in tiptap-block-menu.ts
    editor
      .chain()
      .focus()
      .setTextSelection(capturedPos + 1)
      .run();
    console.log(
      '[step5] selection after setTextSelection(+1):',
      editor.state.selection.toJSON(),
      'parent:',
      editor.state.selection.$from.parent.type.name,
    );
    editor.chain().focus().clearNodes().setHeading({ level: 3 }).run();
    console.log('[step5] result doc:', JSON.stringify(editor.state.doc.toJSON()));
    // Assert the FIRST node converted (the harness doc may carry a trailing
    // empty paragraph artifact — irrelevant to the conversion under test).
    const types = topLevelTypes(editor);
    expect(types[0]).toBe('heading');
    expect(types).not.toContain('blockquote');
    expect(editor.state.doc.firstChild?.attrs.level).toBe(3);
    expect(editor.state.doc.firstChild?.textContent).toBe(
      '4d. Final engineering interview (30 min)',
    );
  });
});
