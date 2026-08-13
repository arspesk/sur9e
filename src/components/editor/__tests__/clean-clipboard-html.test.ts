import { describe, expect, it } from 'vitest';
import { cleanClipboardHtml } from '../clean-clipboard-html';

// The raw serialization ProseMirror puts on the clipboard when a report-body
// table cell is copied (issue #67). Rich-text targets (Gmail, Docs, Notion)
// read text/html first, so this markup is what the user actually pastes.
const RAW_TABLE = `<table class="be-table" style="min-width: 25px;">
<colgroup><col style="min-width: 25px;"></colgroup>
<tbody><tr><td colspan="1" rowspan="1" data-node-id="a1b2"><p>Arsenii Peskovatskov</p></td></tr></tbody>
</table>`;

describe('cleanClipboardHtml', () => {
  it('strips editor-internal table chrome but keeps the content', () => {
    const out = cleanClipboardHtml(RAW_TABLE);
    expect(out).toContain('Arsenii Peskovatskov');
    expect(out).toContain('<table>');
    expect(out).toContain('<td>');
    // Editor internals must be gone.
    expect(out).not.toContain('colgroup');
    expect(out).not.toContain('<col');
    expect(out).not.toContain('be-table');
    expect(out).not.toContain('min-width');
    expect(out).not.toContain('data-node-id');
    // Redundant single-cell spans are noise.
    expect(out).not.toContain('colspan="1"');
    expect(out).not.toContain('rowspan="1"');
  });

  it('preserves real merged-cell spans', () => {
    const out = cleanClipboardHtml(
      '<table><tbody><tr><td colspan="2" rowspan="3"><p>merged</p></td></tr></tbody></table>',
    );
    expect(out).toContain('colspan="2"');
    expect(out).toContain('rowspan="3"');
  });

  it('drops resize handles, editor handles, and contenteditable/draggable attrs', () => {
    const out = cleanClipboardHtml(
      '<p contenteditable="true" draggable="true">hi<span class="column-resize-handle"></span><span class="be-handle"></span></p>',
    );
    expect(out).toContain('hi');
    expect(out).not.toContain('contenteditable');
    expect(out).not.toContain('draggable');
    expect(out).not.toContain('column-resize-handle');
    expect(out).not.toContain('be-handle');
  });

  it('returns empty string unchanged', () => {
    expect(cleanClipboardHtml('')).toBe('');
  });
});
