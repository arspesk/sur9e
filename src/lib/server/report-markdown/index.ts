// src/lib/server/report-markdown/index.ts
//
// Orchestrators for the report-markdown normalizer. `normalizeReportMarkdown`
// runs the auto-fix transforms in order, threading the text and accumulating a
// fix log. `checkReportMarkdown` runs the validators and collects their issues.
// Node-only: never import this from a client component.

import { AUTO_FIXES } from './auto-fix';
import type { Fix, Issue, NormalizeResult } from './types';
import { VALIDATORS } from './validate';

export function normalizeReportMarkdown(md: string): NormalizeResult {
  let out = md;
  const fixes: Fix[] = [];
  for (const fix of AUTO_FIXES) {
    const r = fix(out);
    out = r.md;
    fixes.push(...r.fixes);
  }
  return { markdown: out, fixes };
}

export function checkReportMarkdown(md: string): Issue[] {
  return VALIDATORS.flatMap(v => v(md));
}
