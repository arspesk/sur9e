#!/bin/bash
# SPDX-License-Identifier: MIT
# scan-all.sh — Full pipeline: scan → screen → merge
# Called by launchd weekly. Logs go to data/scan-launchd.log.
# Both scanners self-gate on scanning.sources.{ats,jobspy} in config.yml.

set -e
cd "$(dirname "$0")/.."

echo "=== scan-all.sh start: $(date) ==="

# 1. ATS portal scan (Greenhouse/Ashby/Lever/Workday/Workable — zero tokens)
echo "--- 1/4: ATS portal scan (scan-portals.mjs) ---"
/usr/local/bin/node batch/scan-portals.mjs

# 2. JobSpy (public board listings)
echo "--- 2/4: JobSpy scan (scan-jobspy.mjs) ---"
/usr/local/bin/node batch/scan-jobspy.mjs

# 3. Screening — Haiku writes mini-reports + tracker TSVs
echo "--- 3/4: Screening ---"
/usr/local/bin/node batch/screen.mjs --parallel 20

# 4. Merge results into applications.md
echo "--- 4/4: Merge tracker ---"
/usr/local/bin/node cli/merge-tracker.mjs

echo "=== scan-all.sh done: $(date) ==="
