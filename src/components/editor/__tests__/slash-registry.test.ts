import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetSlashRegistryForTests,
  getSlashItems,
  matchSlashItems,
  registerSlashItem,
  type SlashItem,
  unregisterSlashItem,
} from '../slash-registry';

const noopCommand: SlashItem['command'] = () => {};

describe('slash-registry', () => {
  beforeEach(() => {
    _resetSlashRegistryForTests();
  });

  it('registers and reads back a slash item', () => {
    registerSlashItem({ id: 'h1', group: 'Basic', label: 'Heading 1', command: noopCommand });
    expect(getSlashItems()).toHaveLength(1);
    expect(getSlashItems()[0].id).toBe('h1');
  });

  it('throws when registering a duplicate id in dev', () => {
    registerSlashItem({ id: 'h1', group: 'Basic', label: 'Heading 1', command: noopCommand });
    expect(() =>
      registerSlashItem({
        id: 'h1',
        group: 'Basic',
        label: 'Heading 1 again',
        command: noopCommand,
      }),
    ).toThrow(/duplicate/i);
  });

  it('unregisters by id', () => {
    registerSlashItem({ id: 'h1', group: 'Basic', label: 'Heading 1', command: noopCommand });
    unregisterSlashItem('h1');
    expect(getSlashItems()).toHaveLength(0);
  });

  it('fuzzy matches by label and keywords', () => {
    registerSlashItem({
      id: 'mode-evaluate',
      group: 'AI generation',
      label: 'Evaluate',
      keywords: ['eval', 'offer', 'scoring'],
      command: noopCommand,
    });
    expect(matchSlashItems('eval')).toHaveLength(1);
    expect(matchSlashItems('scoring')).toHaveLength(1);
    expect(matchSlashItems('nope')).toHaveLength(0);
  });

  it('ranks the most literal match first (the auto-suggestion)', () => {
    // Two items where a query substring-matches both, but one is an exact
    // keyword hit. The exact hit must sort first so it gets auto-highlighted.
    registerSlashItem({
      id: 'heading-1',
      group: 'Basic blocks',
      label: 'Heading 1',
      keywords: ['h1', 'title'],
      command: noopCommand,
    });
    registerSlashItem({
      id: 'todo',
      group: 'Basic blocks',
      label: 'To-do list',
      keywords: ['task', 'checkbox'],
      command: noopCommand,
    });
    // "title" only matches the heading (synonym keyword) — exact-ish, ranks it.
    expect(matchSlashItems('title')[0]?.id).toBe('heading-1');
    // "h1" exact keyword on heading.
    expect(matchSlashItems('h1')[0]?.id).toBe('heading-1');
    // Prefix of the label beats a mere subsequence elsewhere.
    expect(matchSlashItems('to-do')[0]?.id).toBe('todo');
  });

  it('falls back to subsequence matching for abbreviations', () => {
    registerSlashItem({
      id: 'ordered',
      group: 'Basic blocks',
      label: 'Numbered list',
      keywords: ['ordered'],
      command: noopCommand,
    });
    // "numlist" is a subsequence of neither field exactly, but "nl" is a
    // subsequence of "Numbered list" (n…l) — loose fallback still finds it.
    expect(matchSlashItems('nl').map(i => i.id)).toContain('ordered');
    // A query that isn't even a subsequence returns nothing.
    expect(matchSlashItems('xyz')).toHaveLength(0);
  });

  it('filters items by shouldShow when context is passed', () => {
    registerSlashItem({
      id: 'basic',
      group: 'Basic blocks',
      label: 'Heading 1',
      command: noopCommand,
    });
    registerSlashItem({
      id: 'mode-evaluate',
      group: 'AI generation',
      label: 'Evaluate',
      command: noopCommand,
      shouldShow: ctx => ctx.num != null,
    });
    // No context → no filtering applied (legacy callers stay broad)
    expect(getSlashItems()).toHaveLength(2);
    // Empty context → mode item filtered out (ctx.num is undefined)
    expect(getSlashItems({})).toHaveLength(1);
    expect(getSlashItems({}).map(i => i.id)).toEqual(['basic']);
    // Report context → mode item visible
    expect(getSlashItems({ num: 16 })).toHaveLength(2);
    // matchSlashItems respects shouldShow too
    expect(matchSlashItems('', {})).toHaveLength(1);
    expect(matchSlashItems('evaluate', {})).toHaveLength(0);
    expect(matchSlashItems('evaluate', { num: 16 })).toHaveLength(1);
  });
});
