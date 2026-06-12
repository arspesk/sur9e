export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { loadProfile, saveProfile } from '@/lib/server/profile';

export function GET() {
  try {
    const profile = loadProfile(ROOT) ?? {};
    return Response.json({
      candidate: profile.candidate ?? {},
      target_roles: profile.target_roles ?? { archetypes: [] },
      narrative: profile.narrative ?? {},
      compensation: profile.compensation ?? {},
      location: profile.location ?? {},
      languages: profile.languages ?? [],
      search: profile.search ?? { terms: [], locations: [] },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load profile');
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonError('Body must be a JSON object', 400);
    }

    const profile = loadProfile(ROOT) ?? {};

    let profileChanged = false;

    // Profile-yml fields: full-replace per top-level key when present in body
    for (const key of [
      'candidate',
      'target_roles',
      'narrative',
      'compensation',
      'location',
      'languages',
      'search',
    ] as const) {
      if (body[key] !== undefined) {
        (profile as Record<string, unknown>)[key] = body[key];
        profileChanged = true;
      }
    }

    if (profileChanged) saveProfile(ROOT, profile);

    return Response.json({ ok: true, profileChanged });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to save profile');
  }
}
