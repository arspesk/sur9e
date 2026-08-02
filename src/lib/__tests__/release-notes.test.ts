import { describe, expect, it } from 'vitest';
import { parseReleaseNotes } from '@/lib/release-notes';

describe('parseReleaseNotes', () => {
  it('extracts feature bullets without compare URLs or commit-link markup', () => {
    const changelog = [
      '## [0.4.0](https://github.com/arspesk/sur9e/compare/v0.3.2...v0.4.0) (2026-08-02)',
      '',
      '### Features',
      '',
      '* add guided status follow-ups ([e458cc4](https://github.com/arspesk/sur9e/commit/e458cc4))',
      '* **status:** guide interview preparation ([6932308](https://github.com/arspesk/sur9e/commit/6932308))',
      '',
      '### Bug Fixes',
      '',
      '* unrelated later section',
    ].join('\n');

    expect(parseReleaseNotes('0.4.0', changelog, '2026-08-02T12:00:00Z')).toEqual({
      title: 'v0.4.0 · Aug 2, 2026',
      items: ['add guided status follow-ups', 'status: guide interview preparation'],
    });
  });

  it('falls back to cleaned prose when release notes have no bullets', () => {
    expect(
      parseReleaseNotes(
        '0.4.1',
        '## [0.4.1](https://github.com/arspesk/sur9e/releases/tag/v0.4.1)\nSafer updates.',
      ),
    ).toEqual({ title: 'v0.4.1', items: ['Safer updates.'] });
  });
});
