// CLI scripts import the .mjs sibling directly; this typed surface is
// for src/server/*.ts and Next.js API routes.

import 'server-only';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PipelineResult } from '../schemas/pipeline';
import { readFileOrNull } from './read-or-null';

// A pending queue line: `- [ ] <url> …`. Same `[ ]` (unchecked) shape
// loadPipeline parses; `[x]` (processed) rows are never matched.
const PENDING_LINE = /^-\s+\[\s\]\s+https?:\/\/\S+/;

export function loadPipeline(rootPath: string): PipelineResult {
  const filePath = join(rootPath, 'data/pipeline.md');
  const content = readFileOrNull(filePath);
  if (content == null) {
    return PipelineResult.parse({ pending: [] });
  }
  const pending: Array<{ url: string; company: string; role: string }> = [];

  // Lines like: - [ ] https://example.com | Company | Role
  for (const line of content.split('\n')) {
    const m = line.match(/^-\s+\[\s\]\s+(https?:\/\/\S+)(?:\s+\|\s+([^|]+?))?(?:\s+\|\s+(.+))?$/);
    if (!m) continue;
    pending.push({
      url: m[1],
      company: (m[2] ?? '').trim(),
      role: (m[3] ?? '').trim(),
    });
  }

  return PipelineResult.parse({ pending });
}

/**
 * Remove every pending (`- [ ]`) entry from data/pipeline.md, leaving the
 * processed (`- [x]`) history and all other content untouched. Returns the
 * number of lines removed. No-op (returns 0) when the file is missing or has
 * no pending rows. Scan-history is intentionally left intact, so a cleared
 * offer is still remembered by dedup and won't silently reappear next scan.
 */
export function clearPending(rootPath: string): number {
  const filePath = join(rootPath, 'data/pipeline.md');
  const content = readFileOrNull(filePath);
  if (content == null) return 0;
  const lines = content.split('\n');
  const kept = lines.filter(line => !PENDING_LINE.test(line));
  const removed = lines.length - kept.length;
  if (removed > 0) writeFileSync(filePath, kept.join('\n'), 'utf-8');
  return removed;
}

export type { PipelineEntry, PipelineResult } from '../schemas/pipeline';
