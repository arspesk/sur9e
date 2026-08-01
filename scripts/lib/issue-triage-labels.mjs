export const ISSUE_LABEL_GROUPS = Object.freeze({
  type: Object.freeze(['type:bug', 'type:feature', 'type:question', 'type:task']),
  area: Object.freeze([
    'area:web',
    'area:agent',
    'area:jobs',
    'area:data',
    'area:tooling',
    'area:docs',
  ]),
  priority: Object.freeze(['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3']),
  status: Object.freeze([
    'status:needs-triage',
    'status:needs-info',
    'status:accepted',
    'status:declined',
  ]),
  resolution: Object.freeze(['resolution:duplicate', 'resolution:invalid', 'resolution:wontfix']),
});

function groupFor(label) {
  return Object.values(ISSUE_LABEL_GROUPS).find(group => group.includes(label));
}

export function exclusiveGroupForLabel(label) {
  return groupFor(label);
}

/**
 * Returns the smallest set of issue-label changes required for a GitHub issue
 * event. Labels outside the triage taxonomy are deliberately left untouched.
 */
export function applyIssueTriageEvent({ action, bodyChanged = false, newestLabel, labels }) {
  const currentLabels = Array.isArray(labels) ? labels : [];

  if (action === 'labeled') {
    const group = groupFor(newestLabel);
    if (!group || !currentLabels.includes(newestLabel)) return { add: [], remove: [] };

    return {
      add: [],
      remove: currentLabels.filter(label => label !== newestLabel && group.includes(label)),
    };
  }

  if (action === 'edited' && bodyChanged && currentLabels.includes('status:needs-info')) {
    return {
      add: currentLabels.includes('status:needs-triage') ? [] : ['status:needs-triage'],
      remove: ['status:needs-info'],
    };
  }

  return { add: [], remove: [] };
}
