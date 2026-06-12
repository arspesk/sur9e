import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../escape-html';

describe('escapeHtml', () => {
  it('escapes html-special characters', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
  it('escapes single quotes as &#39;', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });
  it('coerces null/undefined to empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
