// features/profile/schemas.ts
//
// UI-facing schema: extends the canonical server schema with min(1, 'Required')
// style messages so the rhf form surfaces friendly errors. The canonical schema
// stays the source of truth for API validation.
//
// Required fields (migrated from the legacy REQUIRED_FIELDS array):
//   - candidate.full_name (text)
//   - candidate.email (email)
//   - target_roles.archetypes (at least 1)
//   - search.terms (at least 1) — JobSpy queries one per term
//   - compensation.target_range (text)
//   - search.locations (at least 1)
//   - cv markdown presence is NOT validated here — it lives in a separate
//     store via MdSection / useProfileMdQuery; see profile-form.tsx for how
//     cvHasContent is lifted and checked in the banner.

import { z } from 'zod';
import { ProfileShape } from '@/lib/schemas/profile';

export const ProfileFormSchema = ProfileShape.extend({
  candidate: z
    .object({
      full_name: z.string().min(1, 'Required'),
      email: z.string().email('Invalid email').min(1, 'Required'),
    })
    .passthrough(),
  target_roles: z
    .object({
      archetypes: z.array(z.unknown()).min(1, 'At least one archetype required'),
    })
    .passthrough(),
  search: z
    .object({
      terms: z.array(z.string()).min(1, 'At least one search keyword required'),
      locations: z.array(z.string()).min(1, 'At least one search location required'),
    })
    .passthrough(),
  compensation: z
    .object({
      target_range: z.string().min(1, 'Required'),
    })
    .passthrough(),
});

export type ProfileFormValues = z.infer<typeof ProfileFormSchema>;
