// lib/schemas/profile.ts
//
// zod schema for inputs/personalization/profile.yml. Top-level objects use
// .passthrough() so users with extra keys (e.g. custom personalization
// fields not yet first-class) don't trip parsing. Required-vs-optional
// follows actual consumer usage in loadProfile() callers: candidate +
// search.terms are read by other modules; the rest may be absent on a
// fresh install before onboarding completes.

import { z } from 'zod';

export const ProfileCandidate = z
  .object({
    full_name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    linkedin: z.string().optional(),
    portfolio_url: z.string().optional(),
    github: z.string().optional(),
  })
  .passthrough();

export const ProfileArchetype = z
  .object({
    name: z.string(),
    level: z.string().optional(),
    fit: z.string().optional(),
  })
  .passthrough();

export const ProfileTargetRoles = z
  .object({
    archetypes: z.array(ProfileArchetype).default([]),
    // Preferred years-of-experience band — drives the `seniority` axis in
    // both screen-prompt.md and content/modes/evaluate.md. Format: "{min}-{max}"
    // string (e.g. "2-3", "5-7"), or "any" / omit for neutral scoring.
    preferred_yoe: z.string().optional(),
  })
  .passthrough();

export const ProfileProofPoint = z
  .object({
    name: z.string(),
    url: z.string().optional(),
    hero_metric: z.string().optional(),
  })
  .passthrough();

export const ProfileNarrative = z
  .object({
    headline: z.string().optional(),
    exit_story: z.string().optional(),
    superpowers: z.array(z.string()).optional(),
    proof_points: z.array(ProfileProofPoint).optional(),
  })
  .passthrough();

export const ProfileCompensation = z
  .object({
    target_range: z.string().optional(),
    currency: z.string().optional(),
    acceptable_floor: z.string().optional(),
    minimum: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const ProfileLocation = z
  .object({
    country: z.string().optional(),
    city: z.string().optional(),
    timezone: z.string().optional(),
    visa_status: z.string().optional(),
    onsite_availability: z.string().optional(),
    location_flexibility: z.string().optional(),
  })
  .passthrough();

export const ProfileLanguage = z
  .object({
    name: z.string(),
    proficiency: z.string().optional(),
  })
  .passthrough();

export const ProfileSearch = z
  .object({
    terms: z.array(z.string()).default([]),
    locations: z.array(z.string()).default([]),
  })
  .passthrough();

export const ProfileApplyAnswers = z
  .object({
    // Standing answers to recurring application-form questions, one per
    // line — voluntary self-identification (gender/sex, race/ethnicity,
    // sexual orientation, transgender, disability, veteran status) and
    // other popular ones (work authorization, sponsorship, notice period,
    // how-did-you-hear, security clearance, relocation). The apply mode
    // reads these instead of asking on every form. Editable in the web
    // app: Profile → Apply (Application Questions section).
    additional_info: z.string().optional(),
  })
  .passthrough();

export const ProfileShape = z
  .object({
    // candidate is optional at the schema level so a freshly-initialized
    // profile (pre-onboarding) parses successfully; consumers that need
    // full_name should narrow against ProfileCandidate explicitly.
    candidate: ProfileCandidate.optional(),
    target_roles: ProfileTargetRoles.optional(),
    narrative: ProfileNarrative.optional(),
    compensation: ProfileCompensation.optional(),
    location: ProfileLocation.optional(),
    languages: z.array(ProfileLanguage).optional(),
    search: ProfileSearch.optional(),
    apply_answers: ProfileApplyAnswers.optional(),
  })
  .passthrough();
export type ProfileShape = z.infer<typeof ProfileShape>;
