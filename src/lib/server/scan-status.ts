// src/lib/server/scan-status.ts
//
// Read-only summary for the Settings → Job scanning status panel:
//   - how many offers are pending in the queue (waiting to be screened)
//   - when the most recent scan ran
//
// Pending count is the source of truth in data/pipeline.md (`## Pending`,
// unchecked `- [ ]` rows) — the same queue `screen.mjs` drains. Last-scan
// time is the newest `startedAt` across the persisted scan job records
// (data/jobs/*.json, type 'scan'), which covers both app-triggered and
// scheduled scans; CLI-only `npm run scan` runs leave no job record, so
// that case falls back to null (no scan recorded through the app).

import 'server-only';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPipeline } from './pipeline';

export interface ScanQueueStatus {
  /** Offers in the queue awaiting screening (`- [ ]` rows in pipeline.md). */
  pendingCount: number;
  /** ISO timestamp of the most recent scan job, or null if none recorded. */
  lastScanAt: string | null;
}

export function loadScanQueueStatus(rootPath: string): ScanQueueStatus {
  let pendingCount = 0;
  try {
    pendingCount = loadPipeline(rootPath).pending.length;
  } catch {
    // Malformed pipeline.md — report 0 rather than crash the Settings page.
  }

  let lastScanAt: string | null = null;
  const dir = join(rootPath, 'data', 'jobs');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const job = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as {
          type?: string;
          startedAt?: string;
        };
        if (job.type !== 'scan' || !job.startedAt) continue;
        if (lastScanAt === null || job.startedAt > lastScanAt) lastScanAt = job.startedAt;
      } catch {
        // skip unreadable/unparseable job files
      }
    }
  }

  return { pendingCount, lastScanAt };
}
