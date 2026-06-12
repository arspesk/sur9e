# Examples

Reference files that demonstrate sur9e data formats and conventions. None of these are used at runtime -- they exist so you can see the expected structure before creating your own files.

## Files

| File                                | Demonstrates                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cv-example.md`                     | How to structure `inputs/personalization/cv.md` -- sections, metrics formatting, and proof-point style for a fictional AI engineer (Alex Chen)                                                                                                  |
| `article-digest-example.md`         | How to write `inputs/personalization/article-digest.md` -- compact proof points with hero metrics, architecture summaries, and key decisions per project                                                                                        |
| `sample-report.md`                  | The A-F evaluation report format produced by the evaluation pipeline, with all six blocks (Role Summary through Interview Plan)                                                                                                                 |
| `ats-normalization-test.md`         | Regression fixture for `cli/generate-pdf.mjs` Unicode normalization -- lists every problematic codepoint and its ASCII-safe replacement                                                                                                         |
| `personalization/profile.yml`       | Copy-source for `inputs/personalization/profile.yml` -- your identity, target roles, salary band, and JobSpy search terms                                                                                                                       |
| `personalization/cv.md`             | Copy-source for `inputs/personalization/cv.md` -- your full CV in Markdown, the source of truth for evaluations and generated PDFs                                                                                                              |
| `personalization/narrative.md`      | Copy-source for `inputs/personalization/narrative.md` -- your archetypes, framing, and custom filtering rules (the user customization layer)                                                                                                    |
| `personalization/article-digest.md` | Copy-source for `inputs/personalization/article-digest.md` -- compact proof points per project (optional, improves match quality)                                                                                                               |
| `dual-track-engineer-instructor/`   | Complete profile config for a candidate with two primary archetypes (engineer + instructor), including `inputs/personalization/cv.md`, `inputs/personalization/profile.yml`, and a README explaining when and how to use the dual-track pattern |

## Usage

These files are read-only references. To set up your own sur9e instance:

1. Run `npm run doctor` to check prerequisites.
2. Copy the starter files out of `personalization/` into `inputs/personalization/`, then edit them:
   ```bash
   cp content/examples/personalization/profile.yml inputs/personalization/profile.yml
   cp content/examples/personalization/cv.md inputs/personalization/cv.md
   cp content/examples/personalization/narrative.md inputs/personalization/narrative.md
   cp content/examples/personalization/article-digest.md inputs/personalization/article-digest.md  # optional
   ```
3. Use `cv-example.md` and `article-digest-example.md` as richer structural guides when filling in your CV and proof points (the latter is optional but improves evaluation quality).
4. See the `dual-track-engineer-instructor/` folder if your career spans two distinct archetypes.
