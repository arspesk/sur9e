import type { Metadata } from 'next';
import { ProfilePage } from '@/features/profile/profile-page';
import type { ProfileState } from '@/hooks/use-profile';
import { ROOT } from '@/lib/root';
import { loadProfileResult } from '@/lib/server/profile';

export const metadata: Metadata = {
  title: 'Sur9e — Profile',
};

// Profile keeps force-dynamic. The TipTap editor inside ProfilePage is
// browser-only; Phase 1 swaps the data path to SSR but force-dynamic stays
// until a follow-up audit confirms TipTap's dynamic-import boundary is
// clean enough to allow static pre-paint.
export const dynamic = 'force-dynamic';

export default async function Page() {
  // Fail-soft load: a hand-edited profile.yml that no longer parses must NOT
  // drop the route to its error boundary (redacted + unactionable in prod).
  // `loadError` carries the path + cause down to the client banner instead.
  const { profile: loaded, error: loadError } = loadProfileResult(ROOT);
  const profile = loaded ?? {};

  // Shape matches GET /api/profile so the existing useProfileQuery hook can
  // adopt it as initialData with no transformation.
  const initialData: ProfileState = {
    candidate: profile.candidate ?? {},
    target_roles: profile.target_roles ?? { archetypes: [] },
    narrative: profile.narrative ?? {},
    compensation: profile.compensation ?? {},
    location: profile.location ?? {},
    languages: profile.languages ?? [],
    search: profile.search ?? { terms: [], locations: [] },
  };

  return <ProfilePage initialData={initialData} loadError={loadError} />;
}
