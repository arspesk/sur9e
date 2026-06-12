import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { SettingsPage } from '@/features/settings/settings-page';
import { ROOT } from '@/lib/root';
import type { ScheduleState } from '@/lib/server/jobs/schedule-logic';
import { loadPortals } from '@/lib/server/portals';
import { loadScanQueueStatus } from '@/lib/server/scan-status';
import { loadSettingsResult } from '@/lib/server/settings';

export const metadata: Metadata = {
  title: 'Sur9e — Settings',
};

// force-dynamic stays. An audit found that synchronous filesystem
// reads (loadSettings) don't opt the route out of static prerender in
// Next 15 -- only dynamic APIs (cookies/headers/params/searchParams) do.
// inputs/config/config.yml changes between requests (user edits the file
// directly or via the form's PATCH), so a static snapshot would freeze the
// data at build time. The async server fetch + initialData plumbing still
// makes first paint show real content; this flag just guarantees the read
// happens per-request.
export const dynamic = 'force-dynamic';

function readScheduleState(root: string): ScheduleState | null {
  try {
    const raw = readFileSync(join(root, 'data', 'schedule-state.json'), 'utf-8');
    return JSON.parse(raw) as ScheduleState;
  } catch {
    return null;
  }
}

export default async function Page() {
  // Fail-soft load: when config.yml exists but can't be parsed, `settings`
  // is all defaults and `error` carries the cause — the page renders a
  // "config unreadable" banner instead of silently showing defaults.
  // The repo-relative path keeps the banner copy short (the loader's own
  // `error.path` is the absolute path it was called with).
  const { settings, error } = await loadSettingsResult(
    join(ROOT, 'inputs', 'config', 'config.yml'),
  );
  const loadError = error
    ? { path: 'inputs/config/config.yml', message: error.message, line: error.line }
    : null;
  const lastRunState = readScheduleState(ROOT);
  // ATS portals section's initial data (null = portals.yml doesn't exist yet).
  const portals = loadPortals(ROOT);
  const queueStatus = loadScanQueueStatus(ROOT);
  return (
    <SettingsPage
      initialData={settings}
      lastRunState={lastRunState}
      initialPortals={portals}
      queueStatus={queueStatus}
      loadError={loadError}
    />
  );
}
