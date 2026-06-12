export const runtime = 'nodejs';

import { join } from 'node:path';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { clearProvidersCache } from '@/lib/server/providers/registry';
import { loadSettings, saveSettings } from '@/lib/server/settings';

const SETTINGS_PATH = join(ROOT, 'inputs', 'config', 'config.yml');

export async function GET() {
  try {
    const settings = await loadSettings(SETTINGS_PATH);
    return Response.json(settings);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load settings');
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonError('Body must be a JSON object', 400);
    }
    const merged = await saveSettings(SETTINGS_PATH, body);
    // The providers registry memoizes config.yml per server process. Without
    // this clear, mode→provider resolution (job routing + the modals' cost
    // copy) keeps serving the boot-time config until restart — mirrors
    // saveSettingsAction.
    clearProvidersCache();
    return Response.json({ ok: true, settings: merged });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to save settings');
  }
}
