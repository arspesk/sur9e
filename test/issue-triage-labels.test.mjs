import { describe, expect, it } from 'vitest';
import { applyIssueTriageEvent, ISSUE_LABEL_GROUPS } from '../scripts/lib/issue-triage-labels.mjs';

describe('issue triage label resolution', () => {
  it('keeps the newest prefixed label within its group and preserves unprefixed labels', () => {
    const result = applyIssueTriageEvent({
      action: 'labeled',
      newestLabel: 'priority:p0',
      labels: ['bug', 'type:bug', 'priority:p2', 'priority:p0', 'help wanted'],
    });

    expect(result).toEqual({
      add: [],
      remove: ['priority:p2'],
    });
  });

  it('does not change labels when the newest label is not in the issue taxonomy', () => {
    expect(
      applyIssueTriageEvent({
        action: 'labeled',
        newestLabel: 'good first issue',
        labels: ['type:bug', 'good first issue'],
      }),
    ).toEqual({ add: [], remove: [] });
  });

  it('returns needs-info issues to needs-triage only when the issue body changed', () => {
    expect(
      applyIssueTriageEvent({
        action: 'edited',
        bodyChanged: true,
        newestLabel: null,
        labels: ['type:bug', 'area:web', 'status:needs-info', 'good first issue'],
      }),
    ).toEqual({
      add: ['status:needs-triage'],
      remove: ['status:needs-info'],
    });
  });

  it('leaves needs-info unchanged after a title-only edit', () => {
    expect(
      applyIssueTriageEvent({
        action: 'edited',
        bodyChanged: false,
        newestLabel: null,
        labels: ['type:bug', 'area:web', 'status:needs-info', 'good first issue'],
      }),
    ).toEqual({ add: [], remove: [] });
  });

  it('exposes every exclusive issue-label group including resolution', () => {
    expect(ISSUE_LABEL_GROUPS).toEqual({
      type: ['type:bug', 'type:feature', 'type:question', 'type:task'],
      area: ['area:web', 'area:agent', 'area:jobs', 'area:data', 'area:tooling', 'area:docs'],
      priority: ['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3'],
      status: ['status:needs-triage', 'status:needs-info', 'status:accepted', 'status:declined'],
      resolution: ['resolution:duplicate', 'resolution:invalid', 'resolution:wontfix'],
    });
  });
});
