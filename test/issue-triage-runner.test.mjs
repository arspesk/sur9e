import { describe, expect, it } from 'vitest';
import { runIssueTriage } from '../scripts/lib/issue-triage-runner.mjs';

function fakeGitHub(initialLabels, timelinePages) {
  const defaultTimeline = initialLabels.map((name, index) => ({
    id: index + 1,
    event: 'labeled',
    created_at: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z`,
    label: { name },
  }));
  const state = {
    labels: [...initialLabels],
    calls: [],
    timelinePages: timelinePages ?? [defaultTimeline],
  };
  const execute = async (command, args) => {
    state.calls.push([command, args]);
    if (args[1] === 'view') {
      return { stdout: JSON.stringify({ labels: state.labels.map(name => ({ name })) }) };
    }
    if (args[1] === 'edit') {
      for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--remove-label')
          state.labels = state.labels.filter(name => name !== args[index + 1]);
        if (args[index] === '--add-label' && !state.labels.includes(args[index + 1])) {
          state.labels.push(args[index + 1]);
        }
      }
      return { stdout: '' };
    }
    if (args[0] === 'api') {
      return { stdout: JSON.stringify(state.timelinePages) };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  return { state, execute };
}

describe('live issue triage runner', () => {
  it('does not let a stale labeled event overwrite the current live label state', async () => {
    const { state, execute } = fakeGitHub(['type:bug', 'status:needs-triage', 'good first issue']);

    const result = await runIssueTriage({
      issueNumber: '42',
      repo: 'arspesk/sur9e',
      action: 'labeled',
      newestLabel: 'status:needs-info',
      bodyChanged: false,
      execute,
    });

    expect(result).toEqual({ add: [], remove: [] });
    expect(state.labels).toEqual(['type:bug', 'status:needs-triage', 'good first issue']);
    expect(state.calls).toEqual([
      ['gh', ['issue', 'view', '42', '--repo', 'arspesk/sur9e', '--json', 'labels']],
    ]);
  });

  it.each(['labeled-first', 'body-edit-first'])(
    'converges a needs-info label and reporter body edit to needs-triage when %s',
    async order => {
      const { state, execute } = fakeGitHub(['type:bug', 'good first issue', 'status:needs-info']);
      const labeled = () =>
        runIssueTriage({
          issueNumber: '42',
          repo: 'arspesk/sur9e',
          action: 'labeled',
          newestLabel: 'status:needs-info',
          bodyChanged: false,
          execute,
        });
      const bodyEdit = () =>
        runIssueTriage({
          issueNumber: '42',
          repo: 'arspesk/sur9e',
          action: 'edited',
          newestLabel: null,
          bodyChanged: true,
          execute,
        });

      if (order === 'labeled-first') {
        await labeled();
        await bodyEdit();
      } else {
        await bodyEdit();
        await labeled();
      }

      expect(state.labels).toEqual(['type:bug', 'good first issue', 'status:needs-triage']);
    },
  );

  it.each(['older-event-first', 'newer-event-first'])(
    'keeps area:docs when both live area events are processed %s',
    async order => {
      const timelinePages = [
        [
          {
            id: 10,
            event: 'labeled',
            created_at: '2026-01-01T00:00:00Z',
            label: { name: 'area:web' },
          },
        ],
        [
          {
            id: 20,
            event: 'labeled',
            created_at: '2026-01-01T00:00:00Z',
            label: { name: 'area:docs' },
          },
        ],
      ];
      const { state, execute } = fakeGitHub(['type:bug', 'area:web', 'area:docs'], timelinePages);
      const labeled = newestLabel =>
        runIssueTriage({
          issueNumber: '42',
          repo: 'arspesk/sur9e',
          action: 'labeled',
          newestLabel,
          bodyChanged: false,
          execute,
        });

      if (order === 'older-event-first') {
        await labeled('area:web');
        await labeled('area:docs');
      } else {
        await labeled('area:docs');
        await labeled('area:web');
      }

      expect(state.labels).toEqual(['type:bug', 'area:docs']);
    },
  );

  it('fails closed without mutation when the paginated label timeline is malformed', async () => {
    const { state, execute } = fakeGitHub(
      ['type:bug', 'area:web', 'area:docs'],
      [
        [
          {
            id: 'not-a-number',
            event: 'labeled',
            created_at: '2026-01-01T00:00:00Z',
            label: { name: 'area:docs' },
          },
        ],
      ],
    );

    await expect(
      runIssueTriage({
        issueNumber: '42',
        repo: 'arspesk/sur9e',
        action: 'labeled',
        newestLabel: 'area:web',
        bodyChanged: false,
        execute,
      }),
    ).rejects.toThrow('GitHub returned an invalid issue event timeline.');
    expect(state.labels).toEqual(['type:bug', 'area:web', 'area:docs']);
    expect(state.calls.some(([, args]) => args[1] === 'edit')).toBe(false);
  });
});
