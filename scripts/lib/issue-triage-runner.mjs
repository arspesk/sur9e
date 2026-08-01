import { applyIssueTriageEvent, exclusiveGroupForLabel } from './issue-triage-labels.mjs';

function labelNames(issue) {
  if (
    !Array.isArray(issue?.labels) ||
    !issue.labels.every(label => typeof label?.name === 'string')
  ) {
    throw new Error('GitHub returned an invalid issue label payload.');
  }
  return issue.labels.map(label => label.name);
}

function timelineEvents(pages) {
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error('GitHub returned an invalid issue event timeline.');
  }

  const events = pages.flat();
  for (const event of events) {
    if (
      !event ||
      typeof event !== 'object' ||
      !Number.isSafeInteger(event.id) ||
      typeof event.event !== 'string' ||
      typeof event.created_at !== 'string' ||
      Number.isNaN(Date.parse(event.created_at)) ||
      (event.event === 'labeled' && typeof event.label?.name !== 'string')
    ) {
      throw new Error('GitHub returned an invalid issue event timeline.');
    }
  }
  return events;
}

function latestLiveLabeledLabel({ events, labels, group }) {
  const candidates = events.filter(
    event =>
      event.event === 'labeled' &&
      group.includes(event.label.name) &&
      labels.includes(event.label.name),
  );
  if (candidates.length === 0) return undefined;

  return candidates.reduce((latest, candidate) => {
    const latestTime = Date.parse(latest.created_at);
    const candidateTime = Date.parse(candidate.created_at);
    if (candidateTime > latestTime || (candidateTime === latestTime && candidate.id > latest.id)) {
      return candidate;
    }
    return latest;
  }).label.name;
}

/**
 * Refetches the live issue immediately before resolving an event so delayed
 * workflows cannot overwrite a newer human or automation label change.
 */
export async function runIssueTriage({
  issueNumber,
  repo,
  action,
  bodyChanged,
  newestLabel,
  execute,
}) {
  const { stdout } = await execute('gh', [
    'issue',
    'view',
    issueNumber,
    '--repo',
    repo,
    '--json',
    'labels',
  ]);
  const labels = labelNames(JSON.parse(stdout));
  let effectiveLabel = newestLabel;

  if (action === 'labeled') {
    const group = exclusiveGroupForLabel(newestLabel);
    if (group && labels.includes(newestLabel)) {
      const timeline = await execute('gh', [
        'api',
        '--paginate',
        '--slurp',
        `repos/${repo}/issues/${issueNumber}/events?per_page=100`,
      ]);
      effectiveLabel = latestLiveLabeledLabel({
        events: timelineEvents(JSON.parse(timeline.stdout)),
        labels,
        group,
      });
      if (!effectiveLabel) return { add: [], remove: [] };
    }
  }

  const changes = applyIssueTriageEvent({
    action,
    bodyChanged,
    newestLabel: effectiveLabel,
    labels,
  });

  if (changes.add.length === 0 && changes.remove.length === 0) return changes;

  const args = ['issue', 'edit', issueNumber, '--repo', repo];
  for (const label of changes.remove) args.push('--remove-label', label);
  for (const label of changes.add) args.push('--add-label', label);
  await execute('gh', args);
  return changes;
}
