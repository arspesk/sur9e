'use server';

// Server Action for the settings resource. Deep-merges into config.yml.
// revalidatePath fires for /settings, /table, and /analytics because
// some settings (screening preset, scanning concurrency)
// can affect those surfaces.
//
// /api/settings stays as the JSON compatibility surface.

import { join } from 'node:path';
import { ROOT } from '@/lib/root';
import { clearProvidersCache } from '@/lib/server/providers/registry';
import { loadSettings, type SettingsShape, saveSettings } from '@/lib/server/settings';
import { revalidatePath } from '@/server/revalidate';

const SETTINGS_PATH = join(ROOT, 'inputs', 'config', 'config.yml');

export interface SaveSettingsResult {
  ok: true;
  settings: SettingsShape;
}

/**
 * Read-only action — surfaces the persisted settings for one-shot client
 * bootstrap (e.g. chrome-effects theme resolution before any TanStack
 * context exists). The /settings page itself uses SSR + useSettingsQuery
 * instead of this action.
 */
export async function loadSettingsAction(): Promise<SettingsShape> {
  return loadSettings(SETTINGS_PATH);
}

export async function saveSettingsAction(
  patch: Record<string, unknown>,
): Promise<SaveSettingsResult> {
  const merged = await saveSettings(SETTINGS_PATH, patch);
  // The providers registry memoizes config.yml per server process
  // (loadConfigShallow's module cache). Without this clear, mode→provider
  // resolution — job routing AND the modals' cost copy — keeps serving the
  // boot-time config until restart.
  clearProvidersCache();
  // Whole-route revalidation: inputs/config/config.yml can be hand-
  // edited (users sometimes drop the file in from a template). A
  // tag-based cache would mask those writes. /settings is small so the
  // cost is cheap.
  revalidatePath('/settings');
  // Settings can affect screening + scanning behavior visible on /table
  // (filter defaults) and /analytics (chart cadence).
  // Cheap to invalidate — no real cost.
  revalidatePath('/offers');
  revalidatePath('/analytics');
  return { ok: true, settings: merged };
}
