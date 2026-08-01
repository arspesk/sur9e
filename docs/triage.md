# Issue triage

GitHub Issues are sur9e's only issue-tracking system. They are reviewed by
humans; this project uses no Codex delegation, no Claude delegation, no Linear,
no GitHub Projects, and no reminder bot for triage. There is no issue
implementation planning in phase one.

## Weekly zero-inbox

Once each week, a maintainer works the oldest open triage queue first. The
target is zero `status:needs-triage` issues older than 7 days. Use this saved
query:

```text
is:issue is:open label:"status:needs-triage" sort:created-asc
```

The maintainer either requests the smallest missing detail with
`status:needs-info`, accepts the work, declines it, or closes it with a
resolution. Editing the issue body after a needs-info request returns it to
`status:needs-triage` for fresh human review.

## Taxonomy

Every issue has exactly one primary label in each category once triaged:

- `type:bug`, `type:feature`, `type:question`, or `type:task` says what kind
  of work it represents.
- `area:web`, `area:agent`, `area:jobs`, `area:data`, `area:tooling`, or
  `area:docs` identifies the one primary affected area.
- `priority:p0` is a security risk, data loss, or broadly blocked core
  workflow; `priority:p1` materially impairs a major workflow; `priority:p2`
  is normal planned work; `priority:p3` is deferred polish or niche value.
- `status:needs-triage` means new; `status:needs-info` means information is
  materially missing; `status:accepted` and `status:declined` are human
  maintainer decisions.
- `resolution:duplicate`, `resolution:invalid`, and `resolution:wontfix` are
  human-applied closure reasons. At most one resolution label belongs on an
  issue.

Unprefixed labels are existing PR labels and are not part of this issue
taxonomy.

## Activation

The forms reference the taxonomy labels, and GitHub skips form labels that do
not yet exist. The implementation is inactive until this human-gated activation
is completed; do not merge or enable the forms first.

From this branch, a maintainer must:

1. Review the plan with the default dry run:

   ```bash
   npm run github:labels -- --repo arspesk/sur9e
   ```

2. After explicit approval, create or update the labels with this exact command
   (there is no second `--` before `--apply`):

   ```bash
   npm run github:labels -- --repo arspesk/sur9e --apply
   ```

   The command creates or updates manifest labels only; it never deletes
   labels. Do not run it without that approval.

3. Verify all 21 label names through GitHub CLI before merge:

   ```bash
   gh label list --repo arspesk/sur9e --limit 100 --json name --jq '.[].name'
   ```

   Confirm the output includes every name in `.github/issue-labels.yml`.

4. Only then merge this branch. The workflow does not add a manual dispatch or
   standing label-write permission beyond its scoped issue-event token.

## Automation boundaries

CodeRabbit is an advisory, free-for-OSS helper. On issue creation or edit it
may enrich descriptions and assign exactly one type, primary area, and priority
when evidence supports them. It may apply `status:needs-info` only when details
are materially missing. It does not accept, decline, resolve, close, or make
comments that imply those maintainer-only decisions.

The issue-label workflow only resolves conflicting prefixed labels by keeping
the newest label in its category, and it returns a needs-info report to the
triage queue only when its body changes. It never comments, closes, accepts,
declines, or resolves an issue. Human maintainers retain acceptance, decline,
resolution, and closure authority.

Use the forms' privacy confirmation seriously: do not file secrets, CV content,
job-offer text, credentials, or other personal data in public issues.
