# Releasing sur9e

Releases are maintainer-only. Contributors should use Conventional Commit PR
titles, and maintainers must keep the validated title as the squash commit's
Conventional header; only GitHub's ` (#<number>)` suffix is allowed. The squash
body stays blank. Leave version files and release notes to the automated
workflow.

## Release model

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs
**Release Please** after a push to `main`. When that job creates a release,
**Release SBOM** attaches its supply-chain inventory. A manual repair dispatch
runs only **Release SBOM**.

- An ordinary merge to `main` may create or update the Release Please PR when
  releasable Conventional Commits are present. It does not create a tag or
  GitHub release.
- Merging the Release Please PR is the only normal path that creates the
  `vX.Y.Z` tag and corresponding GitHub release.
- Release Please derives the version bump, `CHANGELOG.md`, and GitHub release
  notes deterministically from the Conventional Commits that land on `main`.
  Release notes are not AI-authored.
- The release model assumes squash-only history: one validated PR title forms
  one Conventional Commit header on `main`, optionally followed by GitHub's PR
  number suffix. The body is blank; merge commits and rebase merges are not
  supported.

Use `feat`, `fix`, `perf`, and breaking-change markers accurately: their
semantics affect the proposed release. Other allowed PR-title types still keep
the merge history structured.

## Version integrity

Release Please owns the release PR changes to:

- `package.json`
- the root package version fields in `package-lock.json`
- `.release-please-manifest.json`
- `CHANGELOG.md`

The workflow checks out the release PR branch, runs
`node scripts/sync-release-version.mjs`, and commits `VERSION` back to that
branch when necessary. The quick gate fails unless all version sources agree.

Do not manually bump these files in an ordinary contribution. If release
metadata drifts, fix the automation or its integrity tests instead of creating a
manual tag.

## Maintainer release procedure

1. Confirm the Release Please PR proposes the intended SemVer bump and
   changelog.
2. Confirm `VERSION`, `package.json`, `package-lock.json`, and the manifest all
   carry the same version.
3. Wait for every applicable PR check and review the complete generated diff.
4. Merge the Release Please PR.
5. Verify the **Release Please** and **Release SBOM** jobs completed on the merge
   commit.
6. Verify the `vX.Y.Z` tag, GitHub release, deterministic notes, and attached
   `sur9e.spdx.json` SPDX SBOM.

If SBOM generation or upload fails after the release exists, open GitHub
Actions → **Release** → **Run workflow**, enter the existing strict tag (for
example, `v0.2.0`) in the required `release_tag` field, and run it. This repair
path skips Release Please, validates the existing tag, release, and commit
provenance, regenerates `sur9e.spdx.json`, and replaces the release asset. It
cannot create a tag or release. Do not rerun the original merge job or create a
competing tag to repair an SBOM.

## Release scope

The workflow creates a Git tag and GitHub release and attaches an SPDX JSON
SBOM. It does not:

- publish sur9e to npm;
- build or publish a container;
- deploy to a hosted target; or
- release after every ordinary merge to `main`.

## One-time GitHub setup

These are remote repository prerequisites, not settings configured by files in
this repo. Do not assume any of them are active until a maintainer verifies them:

1. Add the repository Actions secret `RELEASE_PLEASE_TOKEN`. Use a token scoped
   to this repository with Contents, Issues, and Pull requests read/write so it
   can update the release PR, push `VERSION`, create tags/releases, attach the
   SBOM, and trigger follow-on workflows. Do not replace it with the default
   `GITHUB_TOKEN`, whose events do not trigger the required follow-on runs. The
   workflow's default token remains read-only; all mutations use this secret.
2. Enable squash merging, disable merge commits and rebase merging, and set the
   default squash commit title to **Pull request title**
   (`squash_merge_commit_title=PR_TITLE` through the GitHub API). Set the default
   squash commit message to **Blank**
   (`squash_merge_commit_message=BLANK`). Confirm the validated title remains
   the Conventional header; only GitHub's PR-number suffix is allowed.
3. Create the labels used by `.github/labeler.yml`: `ui`, `server`,
   `agent-behavior`, `modes`, `scripts`, `tests`, `documentation`,
   `dependencies`, and `ci`.
4. If installing the CodeRabbit GitHub App, grant it access to this selected
   repository only. Review its requested read/write access to repository
   code/contents, commit statuses, issues, and pull requests before approval.
   Its findings remain actionable, but keep it advisory for merge gating and
   not a required check. Retain disabled automatic replies and
   non-organization-member chat. During rollout, prohibit Autofix, direct
   commits, stacked PRs, and code-editing chat commands.
5. Enable GitHub's Dependency Graph, Dependabot alerts, and Dependabot security
   updates. The tracked Dependabot configuration opens version-update PRs, but
   repository security settings are still remote prerequisites.
6. Let each workflow run successfully before selecting required branch/ruleset
   checks. Candidate project checks are **Quick quality gate**, **Production
   build**, **Fresh-clone Playwright smoke**, **No private user data**,
   **Validate PR title**, **High-severity dependency gate**, and **CodeQL
   analysis**. Keep CodeRabbit advisory and never enable automatic dependency
   merging.
