import { describe, expect, it } from 'vitest';
import { preprocessLegacyToggles } from '../legacy-toggle-shim';

const LEGACY = [
  '<details data-toggle-heading data-level="3" open>',
  '',
  '<div data-toggle-summary="" class="toggle-h__summary">Alt phrasings</div>',
  '',
  '<div data-toggle-body="" class="toggle-h__body">',
  '',
  '1. First phrasing.',
  '2. Second phrasing.',
  '',
  '</div>',
  '',
  '</details>',
].join('\n');

describe('preprocessLegacyToggles', () => {
  it('converts a legacy toggle to a heading + unwrapped body', () => {
    const out = preprocessLegacyToggles(LEGACY);
    expect(out).toContain('### Alt phrasings');
    expect(out).toContain('1. First phrasing.');
    expect(out).toContain('2. Second phrasing.');
    expect(out).not.toContain('data-toggle');
    expect(out).not.toContain('<details');
  });

  it('defaults to level 2 when data-level is missing', () => {
    const md =
      '<details data-toggle-heading>\n\n<div data-toggle-summary>S</div>\n\n<div data-toggle-body>\n\nbody\n\n</div>\n\n</details>';
    expect(preprocessLegacyToggles(md)).toContain('## S');
  });

  it('passes through markdown with no legacy toggles unchanged', () => {
    const md = '## Normal\n\nSome text.';
    expect(preprocessLegacyToggles(md)).toBe(md);
  });

  it('never leaks raw <div>/</div> or trailing siblings into the output', () => {
    const md = [
      '<details data-toggle-heading data-level="2">',
      '<div data-toggle-summary>Title</div>',
      '<div data-toggle-body>',
      '',
      'Body line.',
      '',
      '</div>',
      '</details>',
    ].join('\n');
    const out = preprocessLegacyToggles(md);
    expect(out).toContain('## Title');
    expect(out).toContain('Body line.');
    expect(out).not.toContain('<div');
    expect(out).not.toContain('</div>');
  });
});
